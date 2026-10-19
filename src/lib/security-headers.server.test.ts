import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders } from './security-headers.server';

describe('security headers', () => {
  it('uses a nonce in the production script policy without inline allowances', () => {
    const headers = buildSecurityHeaders({ nonce: 'synthetic-nonce', dev: false });
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain("script-src 'self' 'nonce-synthetic-nonce'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('keeps the inline allowance only for the Vite dev server', () => {
    const csp = buildSecurityHeaders({ nonce: 'synthetic-nonce', dev: true })['Content-Security-Policy'];
    expect(csp).toContain("script-src 'self' 'nonce-synthetic-nonce' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('has no wildcard or remote script source', () => {
    const csp = buildSecurityHeaders({ nonce: 'synthetic-nonce', dev: false })['Content-Security-Policy'];
    expect(csp).not.toContain('*');
    expect(csp).not.toContain('http:');
    expect(csp).not.toContain('https:');
  });
});
