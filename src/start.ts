import { randomBytes } from 'node:crypto';
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';
import { appEnv } from './lib/env.server';
import { logEvent } from './lib/log.server';
import { buildSecurityHeaders } from './lib/security-headers.server';

const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' });
const dev = process.env.NODE_ENV !== 'production';

function applyBaselineHeaders(response: Response, requestId: string, noStore: boolean, nonce: string) {
  for (const [name, value] of Object.entries(buildSecurityHeaders({ nonce, dev }))) {
    response.headers.set(name, value);
  }
  response.headers.set('X-Request-Id', requestId);
  if (noStore) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
}

const baselineMiddleware = createMiddleware().server(async ({ next, request }) => {
  const requestId = request.headers.get('x-nf-request-id') ?? crypto.randomUUID();
  const nonce = randomBytes(18).toString('base64');
  const path = new URL(request.url).pathname;
  // Signed-in host pages, auth endpoints, and guest pages must never be cached by shared caches.
  const noStore =
    path === '/host' ||
    path.startsWith('/host/') ||
    path.startsWith('/auth/') ||
    path.startsWith('/_serverFn/') ||
    path === '/g' ||
    path.startsWith('/g/');
  let result: Awaited<ReturnType<typeof next>>;
  try {
    result = await next({ context: { nonce } });
  } catch (error) {
    // Rethrow Start control flow (thrown Responses, aborts); handle real failures here so Start's raw fallback logger never sees request data.
    if (error instanceof Response || request.signal.aborted) {
      throw error;
    }
    const response = new Response(null, { status: 500 });
    applyBaselineHeaders(response, requestId, noStore, nonce);
    logEvent('server_error', { requestId, appEnv, method: request.method, path, status: 500, outcome: 'thrown' });
    return response;
  }

  // HTML embeds the per-request CSP nonce, so a shared cache must never replay a document.
  const html = result.response.headers.get('content-type')?.toLowerCase().startsWith('text/html') ?? false;
  applyBaselineHeaders(result.response, requestId, noStore || html, nonce);
  if (result.response.status >= 500) {
    logEvent('server_error', {
      requestId,
      appEnv,
      method: request.method,
      path,
      status: result.response.status,
      outcome: 'returned',
    });
  }
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [baselineMiddleware, csrfMiddleware],
}));
