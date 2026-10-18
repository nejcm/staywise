import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { serverEnv } from './env.server';

// Host session window aligned to the configured 30-day Supabase session time box (P3).
const HOST_SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const PKCE_VERIFIER_MAX_AGE = 10 * 60;

export type AuthCookie = { name: string; value: string };

// Enforced flags for every auth cookie: HttpOnly, SameSite=Lax, Path=/. `secure` is omitted only
// for the local http development origin (implementation_plan.md §5 Phase 2 localhost override).
export function serializeAuthCookie(cookie: AuthCookie, secure: boolean): string {
  const maxAge =
    cookie.value === '' ? 0 : cookie.name.includes('code-verifier') ? PKCE_VERIFIER_MAX_AGE : HOST_SESSION_MAX_AGE;
  return serializeCookieHeader(cookie.name, cookie.value, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure,
    maxAge,
  });
}

// Deletion copies for the PKCE verifier cookies so a failed callback cannot leave stale verifiers.
export function clearCodeVerifierCookies(cookieHeader: string | null): AuthCookie[] {
  return parseCookieHeader(cookieHeader ?? '')
    .filter((cookie) => cookie.name.includes('code-verifier'))
    .map((cookie) => ({ name: cookie.name, value: '' }));
}

// Deletion copies for session cookies so a revoked or rejected session cannot be replayed later.
export function clearSessionCookies(cookieHeader: string | null): AuthCookie[] {
  return parseCookieHeader(cookieHeader ?? '')
    .filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))
    .map((cookie) => ({ name: cookie.name, value: '' }));
}

export function authCookieHeaders(cookies: AuthCookie[], extraHeaders: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }
  // One cookie per name, last write wins; duplicates would emit conflicting Set-Cookie headers.
  const latest = new Map<string, string>();
  for (const cookie of cookies) latest.set(cookie.name, cookie.value);
  for (const [name, value] of latest) {
    headers.append('Set-Cookie', serializeAuthCookie({ name, value }, serverEnv.appEnv !== 'local'));
  }
  // Auth responses are session state: never cacheable by shared caches.
  headers.set('Cache-Control', 'private, no-store');
  return headers;
}
