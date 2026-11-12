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
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
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

  it('features from later phases reject as not implemented', async () => {
    _setTokensForTest(fresh());
    await expect(liveDataSource.listAudit()).rejects.toMatchObject({ reason: 'not-implemented' });
    await expect(
      liveDataSource.startLab('nginx-outage', { idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ reason: 'not-implemented' });
  });
});
