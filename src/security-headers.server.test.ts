import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers.server';

describe('securityHeaders', () => {
  it('denies framing and referrer leakage', () => {
    expect(securityHeaders['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(securityHeaders['Content-Security-Policy']).toContain("object-src 'none'");
    expect(securityHeaders['Referrer-Policy']).toBe('no-referrer');
    expect(securityHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(securityHeaders['Permissions-Policy']).toContain('camera=()');
  });
});
