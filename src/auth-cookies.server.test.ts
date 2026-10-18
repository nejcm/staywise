import { describe, expect, it } from 'vitest';
import {
  authCookieHeaders,
  clearCodeVerifierCookies,
  clearSessionCookies,
  serializeAuthCookie,
} from './auth-cookies.server';

describe('serializeAuthCookie', () => {
  it('enforces HttpOnly, SameSite=Lax, Path=/ and the 30-day host session window', () => {
    const cookie = serializeAuthCookie({ name: 'sb-127-auth-token', value: 'x' }, false);
    expect(cookie).toContain('sb-127-auth-token=x');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('adds Secure outside the local http origin override', () => {
    expect(serializeAuthCookie({ name: 'sb-127-auth-token', value: 'x' }, true)).toContain('Secure');
  });

  it('caps the PKCE verifier at ten minutes', () => {
    const cookie = serializeAuthCookie({ name: 'sb-127-auth-token-flow-abc12345-code-verifier', value: 'v' }, false);
    expect(cookie).toContain('Max-Age=600');
  });

  it('turns empty values into immediate deletion cookies', () => {
    const cookie = serializeAuthCookie({ name: 'sb-127-auth-token', value: '' }, false);
    expect(cookie).toContain('Max-Age=0');
  });
});

describe('clearCodeVerifierCookies', () => {
  it('emits deletions only for verifier cookies present on the request', () => {
    const deletions = clearCodeVerifierCookies(
      'other=1; sb-127-auth-token-flow-abc12345-code-verifier=v; sb-127-auth-token=x',
    );
    expect(deletions).toEqual([{ name: 'sb-127-auth-token-flow-abc12345-code-verifier', value: '' }]);
    expect(clearCodeVerifierCookies(null)).toEqual([]);
  });
});

describe('clearSessionCookies', () => {
  it('emits deletions for session cookies, including chunks and flow-scoped names', () => {
    const deletions = clearSessionCookies(
      'other=1; sb-127-auth-token=abc; sb-127-auth-token.0=x; sb-127-auth-token.1=y; sb-127-auth-token-flow-abc12345-code-verifier=v',
    );
    expect(deletions).toEqual([
      { name: 'sb-127-auth-token', value: '' },
      { name: 'sb-127-auth-token.0', value: '' },
      { name: 'sb-127-auth-token.1', value: '' },
    ]);
    expect(clearSessionCookies(null)).toEqual([]);
  });
});

describe('authCookieHeaders', () => {
  it('keeps one Set-Cookie per name with last-write-wins and marks responses no-store', () => {
    const headers = authCookieHeaders(
      [
        { name: 'a', value: 'first' },
        { name: 'a', value: '' },
      ],
      { 'Cache-Control': 'public, max-age=3600' },
    );
    const setCookies = headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain('a=;');
    expect(setCookies[0]).toContain('Max-Age=0');
    expect(headers.get('Cache-Control')).toBe('private, no-store');
  });
});
