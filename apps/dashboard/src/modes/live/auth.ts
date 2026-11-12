import { create } from 'zustand';

import { env } from '@/config/env';

/**
 * Cognito Hosted UI sign-in with Authorization Code + PKCE (blueprint §9.3).
 * Public client: no secret exists anywhere in the browser. Tokens live in
 * sessionStorage for this tab only and are cleared on sign-out or any 401.
 * This module never imports Demo Mode code.
 */

const TOKENS_KEY = 'opsentra:live-auth';
const PKCE_KEY = 'opsentra:pkce';
const SKEW_MS = 60_000;

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

interface AuthState {
  signedIn: boolean;
  setSignedIn: (v: boolean) => void;
}

export const useLiveAuth = create<AuthState>()((set) => ({
  signedIn: readTokens() !== undefined,
  setSignedIn: (signedIn) => set({ signedIn }),
}));

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function readTokens(): Tokens | undefined {
  try {
    const raw = storage()?.getItem(TOKENS_KEY);
    if (!raw) return undefined;
    const t = JSON.parse(raw) as Tokens;
    return typeof t.accessToken === 'string' && typeof t.expiresAt === 'number' ? t : undefined;
  } catch {
    return undefined;
  }
}

function writeTokens(t: Tokens | undefined): void {
  try {
    if (t) storage()?.setItem(TOKENS_KEY, JSON.stringify(t));
    else storage()?.removeItem(TOKENS_KEY);
  } catch {
    /* storage unavailable: the user simply signs in again */
  }
  useLiveAuth.getState().setSignedIn(Boolean(t));
}

// ------------------------------------------------------------------ PKCE ---

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** S256 code challenge for a verifier (RFC 7636). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function hostedUi(path: string): string {
  if (!env.cognitoDomain) throw new Error('Cognito domain is not configured.');
  return `https://${env.cognitoDomain}${path}`;
}

export function redirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}auth/callback`;
}

export async function buildAuthorizeUrl(): Promise<string> {
  if (!env.cognitoClientId) throw new Error('Cognito client is not configured.');
  const verifier = randomString(48);
  const state = randomString(16);
  storage()?.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.cognitoClientId,
    redirect_uri: redirectUri(),
    scope: 'openid profile',
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `${hostedUi('/oauth2/authorize')}?${params.toString()}`;
}

export async function beginSignIn(): Promise<void> {
  window.location.assign(await buildAuthorizeUrl());
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(hostedUi('/oauth2/token'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`Sign-in failed (HTTP ${res.status}).`);
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error('Sign-in failed: no access token.');
  return {
    accessToken: json.access_token,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/** Handles /auth/callback. Rejects on a state mismatch (CSRF) or a Cognito error. */
export async function completeSignIn(search: string): Promise<void> {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (error) throw new Error(`Sign-in was not completed (${error}).`);
  const code = params.get('code');
  const state = params.get('state');
  const saved = storage()?.getItem(PKCE_KEY);
  storage()?.removeItem(PKCE_KEY);
  if (!code || !state || !saved) throw new Error('Sign-in response is incomplete.');
  const { verifier, state: expected } = JSON.parse(saved) as { verifier: string; state: string };
  if (state !== expected) throw new Error('Sign-in state did not match. Please try again.');
  if (!env.cognitoClientId) throw new Error('Cognito client is not configured.');
  writeTokens(
    await tokenRequest({
      grant_type: 'authorization_code',
      client_id: env.cognitoClientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  );
}

/** A valid access token, refreshed if needed; undefined when signed out. */
export async function accessToken(): Promise<string | undefined> {
  const t = readTokens();
  if (!t) return undefined;
  if (t.expiresAt - SKEW_MS > Date.now()) return t.accessToken;
  if (!t.refreshToken || !env.cognitoClientId) {
    writeTokens(undefined);
    return undefined;
  }
  try {
    const fresh = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: env.cognitoClientId,
      refresh_token: t.refreshToken,
    });
    writeTokens({ ...fresh, refreshToken: fresh.refreshToken ?? t.refreshToken });
    return fresh.accessToken;
  } catch {
    writeTokens(undefined);
    return undefined;
  }
}

/** Clears local tokens; optionally ends the Hosted UI session too. */
export function signOut(redirect = true): void {
  writeTokens(undefined);
  if (redirect && env.cognitoDomain && env.cognitoClientId) {
    const params = new URLSearchParams({
      client_id: env.cognitoClientId,
      logout_uri: `${window.location.origin}${import.meta.env.BASE_URL}`,
    });
    window.location.assign(`${hostedUi('/logout')}?${params.toString()}`);
  }
}

/** Test helper. */
export function _setTokensForTest(t: Tokens | undefined): void {
  writeTokens(t);
}
