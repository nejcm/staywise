import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';
import { appEnv } from './env.server';
import { logEvent } from './log.server';
import { securityHeaders } from './security-headers.server';

const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' });

function applyBaselineHeaders(response: Response, requestId: string, noStore: boolean) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.headers.set(name, value);
  }
  response.headers.set('X-Request-Id', requestId);
  if (noStore) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
}

const baselineMiddleware = createMiddleware().server(async ({ next, request }) => {
  const requestId = request.headers.get('x-nf-request-id') ?? crypto.randomUUID();
  const path = new URL(request.url).pathname;
  // Signed-in host pages, auth endpoints, and guest pages must never be cached by shared caches.
  const noStore =
    path === '/host' ||
    path.startsWith('/host/') ||
    path.startsWith('/auth/') ||
    path === '/g' ||
    path.startsWith('/g/');
  let result: Awaited<ReturnType<typeof next>>;
  try {
    result = await next();
  } catch (error) {
    // Rethrow Start control flow (thrown Responses, aborts); handle real failures here so Start's raw fallback logger never sees request data.
    if (error instanceof Response || request.signal.aborted) {
      throw error;
    }
    const response = new Response(null, { status: 500 });
    applyBaselineHeaders(response, requestId, noStore);
    logEvent('server_error', { requestId, appEnv, method: request.method, path, status: 500, outcome: 'thrown' });
    return response;
  }

  applyBaselineHeaders(result.response, requestId, noStore);
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
