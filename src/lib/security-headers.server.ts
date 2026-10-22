// Vite dev injects scripts/styles without a nonce; the generated production build uses nonces and
// external CSS only, so the inline allowances are deliberately limited to development (`APP_ENV=local`).
// Deployed environments (`hsts`) are HTTPS only, so they also pin HSTS rather than relying on the platform default.
export function buildSecurityHeaders(input: { nonce?: string; dev: boolean; hsts: boolean }): Record<string, string> {
  const script = [
    "'self'",
    ...(input.nonce ? [`'nonce-${input.nonce}'`] : []),
    ...(input.dev ? ["'unsafe-inline'"] : []),
  ];
  const style = ["'self'", ...(input.dev ? ["'unsafe-inline'"] : [])];
  return {
    'Content-Security-Policy': `default-src 'self'; script-src ${script.join(' ')}; style-src ${style.join(' ')}; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    // No includeSubDomains: a custom apex domain would otherwise pin every subdomain the host runs elsewhere.
    ...(input.hsts ? { 'Strict-Transport-Security': 'max-age=63072000' } : {}),
  };
}
