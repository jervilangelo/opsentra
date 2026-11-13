import { ApiRequestError, LiveUnavailableError } from '@/api/errors';

vi.mock('@/config/env', () => ({
  env: {
    defaultMode: 'demo',
    apiBaseUrl: 'https://api.example.test',
    cognitoUserPoolId: 'ap-southeast-1_Test',
    cognitoClientId: 'client123',
    cognitoDomain: 'opsentra-test.auth.ap-southeast-1.amazoncognito.com',
  },
  liveConfigured: () => true,
  LIVE_REGION: 'ap-southeast-1',
}));

const {
  _setTokensForTest,
  base64url,
  buildAuthorizeUrl,
  codeChallenge,
  completeSignIn,
  useLiveAuth,
} = await import('./auth');
const { getLiveStatus, liveDataSource } = await import('./liveDataSource');

const fresh = () => ({ accessToken: 'tok', expiresAt: Date.now() + 3_600_000 });

function respond(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  _setTokensForTest(undefined);
});

describe('PKCE', () => {
  it('computes the RFC 7636 S256 challenge', async () => {
    // Appendix B test vector.
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('base64url has no padding or unsafe characters', () => {
    expect(base64url(new Uint8Array([251, 255, 254]))).toBe('-__-');
  });

  it('builds an authorize URL with code + S256 and no secret', async () => {
    const url = new URL(await buildAuthorizeUrl());
    expect(url.origin).toBe('https://opsentra-test.auth.ap-southeast-1.amazoncognito.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_secret')).toBeNull();
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/auth\/callback$/);
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('rejects a callback whose state does not match (CSRF)', async () => {
    await buildAuthorizeUrl();
    await expect(completeSignIn('?code=abc&state=forged')).rejects.toThrow(/state did not match/);
    expect(useLiveAuth.getState().signedIn).toBe(false);
  });

  it('exchanges the code with the stored verifier', async () => {
    const url = new URL(await buildAuthorizeUrl());
    const state = url.searchParams.get('state') ?? '';
    const spy = respond(200, { access_token: 'acc', refresh_token: 'ref', expires_in: 3600 });
    await completeSignIn(`?code=abc&state=${state}`);
    const [, init] = spy.mock.calls[0]!;
    const body = new URLSearchParams(String((init as RequestInit).body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('client_secret')).toBeNull();
    expect(useLiveAuth.getState().signedIn).toBe(true);
  });
});

describe('live data source fails closed', () => {
  it('is signed-out until there is a token', () => {
    expect(getLiveStatus(false)).toEqual({ available: false, reason: 'signed-out' });
    expect(getLiveStatus(true)).toEqual({ available: true });
  });

  it('rejects without a token and never calls the API', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(liveDataSource.listResources()).rejects.toBeInstanceOf(LiveUnavailableError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends the bearer token and returns live data', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, { data: [], meta: { dataset: 'live', generatedAt: 'x' } });
    const res = await liveDataSource.listResources();
    expect(res.data).toEqual([]);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/resources');
    expect((init as RequestInit).headers).toEqual({ authorization: 'Bearer tok' });
  });

  it('a 401 signs out and rejects', async () => {
    _setTokensForTest(fresh());
    respond(401, { message: 'Unauthorized' });
    await expect(liveDataSource.getOverview()).rejects.toMatchObject({ reason: 'unauthenticated' });
    expect(useLiveAuth.getState().signedIn).toBe(false);
  });

  it('an API error keeps its code and request ID', async () => {
    _setTokensForTest(fresh());
    respond(403, { error: { code: 'FORBIDDEN', message: 'no', requestId: 'r1' } });
    await expect(liveDataSource.listIncidents()).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      requestId: 'r1',
    });
  });

  it('a network failure rejects', async () => {
    _setTokensForTest(fresh());
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(liveDataSource.listResources()).rejects.toMatchObject({ reason: 'network' });
  });

  it('refuses a payload that is not marked live', async () => {
    _setTokensForTest(fresh());
    respond(200, { data: [], meta: { dataset: 'synthetic', generatedAt: 'x' } });
    await expect(liveDataSource.listResources()).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('analytics sends the range as encoded query parameters (Phase 8)', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, { data: {}, meta: { dataset: 'live' } });
    await liveDataSource.getAnalytics({ from: '2026-11-01T00:00:00Z', to: '2026-11-12T00:00:00Z' });
    expect(String(spy.mock.calls[0]![0])).toBe(
      'https://api.example.test/v1/analytics?from=2026-11-01T00%3A00%3A00Z&to=2026-11-12T00%3A00%3A00Z',
    );
  });

  it('lab start sends only the scenario ID, the confirmation and the idempotency key (ADR-018)', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, { data: { id: 'nginx-outage' }, meta: { dataset: 'live' } });
    await liveDataSource.startLab('nginx-outage', { idempotencyKey: 'k-lab' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.test/v1/labs/nginx-outage/start');
    const req = init as RequestInit;
    expect(req.method).toBe('POST');
    expect(JSON.parse(String(req.body))).toEqual({ acknowledgeImpact: true });
    expect((req.headers as Record<string, string>)['idempotency-key']).toBe('k-lab');
  });

  it('lab reset posts to the reset route with an idempotency key', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, { data: { id: 'nginx-outage' }, meta: { dataset: 'live' } });
    await liveDataSource.resetLab('nginx-outage', { idempotencyKey: 'k-reset' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.test/v1/labs/nginx-outage/reset');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({});
  });

  it('acknowledge sends POST, the idempotency key, version and reason, and never a role', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, {
      data: { id: 'INC-1', state: 'ACKNOWLEDGED' },
      meta: { dataset: 'live', generatedAt: 'x' },
    });
    await liveDataSource.acknowledgeIncident('INC-1', {
      expectedVersion: 3,
      reason: 'on it',
      idempotencyKey: 'key-123',
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/incidents/INC-1/acknowledge');
    const req = init as RequestInit;
    expect(req.method).toBe('POST');
    expect(req.headers).toMatchObject({
      'idempotency-key': 'key-123',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(req.body))).toEqual({ expectedVersion: 3, reason: 'on it' });
  });

  it('a 409 from a write keeps its code for the dialog', async () => {
    _setTokensForTest(fresh());
    respond(409, { error: { code: 'VERSION_CONFLICT', message: 'changed', requestId: 'r2' } });
    await expect(
      liveDataSource.closeIncident('INC-1', { expectedVersion: 1, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
  });

  it('reads the audit trail from the API', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, { data: [], meta: { dataset: 'live', generatedAt: 'x' } });
    await liveDataSource.listAudit();
    expect(spy.mock.calls[0]![0]).toBe('https://api.example.test/v1/audit');
  });

  it('requesting recovery sends only the runbook ID, never a resource or document', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, {
      data: { requestId: 'REQ-1', status: 'PENDING' },
      meta: { dataset: 'live', generatedAt: 'x' },
    });
    await liveDataSource.requestRemediation('INC-1', {
      expectedVersion: 3,
      runbookId: 'rb-restart-nginx',
      reason: 'Nginx is down',
      idempotencyKey: 'key-9',
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/incidents/INC-1/request-remediation');
    const req = init as RequestInit;
    expect(req.method).toBe('POST');
    expect(req.headers).toMatchObject({ 'idempotency-key': 'key-9' });
    expect(JSON.parse(String(req.body))).toEqual({
      expectedVersion: 3,
      runbookId: 'rb-restart-nginx',
      reason: 'Nginx is down',
    });
  });

  it('a decision posts the choice with its guard', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, {
      data: { requestId: 'REQ-1', status: 'APPROVED' },
      meta: { dataset: 'live', generatedAt: 'x' },
    });
    await liveDataSource.decideRemediation('REQ-1', {
      expectedVersion: 4,
      decision: 'APPROVE',
      reason: 'lab only',
      idempotencyKey: 'key-10',
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/v1/remediations/REQ-1/decision');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      expectedVersion: 4,
      decision: 'APPROVE',
      reason: 'lab only',
    });
  });

  it('reads runbooks and filters recovery requests by incident', async () => {
    _setTokensForTest(fresh());
    const spy = respond(200, { data: [], meta: { dataset: 'live', generatedAt: 'x' } });
    await liveDataSource.listRunbooks();
    await liveDataSource.listRemediations('INC 1');
    await liveDataSource.listRemediations();
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      'https://api.example.test/v1/runbooks',
      'https://api.example.test/v1/remediations?incidentId=INC%201',
      'https://api.example.test/v1/remediations',
    ]);
  });
});

describe('throttling and transient network failures (live gate 2026-11-13)', () => {
  it('retries a 429 with the same idempotency key, then returns the result', async () => {
    _setTokensForTest(fresh());
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 429 })))
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ data: { id: 'nginx-outage' }, meta: { dataset: 'live' } }),
            {
              status: 200,
            },
          ),
        ),
      );
    await liveDataSource.startLab('nginx-outage', { idempotencyKey: 'same-key' });
    expect(spy).toHaveBeenCalledTimes(3);
    const keys = spy.mock.calls.map(
      ([, init]) => ((init as RequestInit).headers as Record<string, string>)['idempotency-key'],
    );
    expect(new Set(keys)).toEqual(new Set(['same-key']));
  }, 10_000);

  it('gives up after two retries and fails closed', async () => {
    _setTokensForTest(fresh());
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(liveDataSource.listIncidents()).rejects.toMatchObject({ reason: 'network' });
    expect(spy).toHaveBeenCalledTimes(3);
  }, 10_000);
});
