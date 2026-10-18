import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';
import { appEnv } from './env.server';
import { logEvent } from './log.server';
import { securityHeaders } from './security-headers.server';

const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' });

function applyBaselineHeaders(response: Response, requestId: string) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.headers.set(name, value);
  }
  response.headers.set('X-Request-Id', requestId);
}

const baselineMiddleware = createMiddleware().server(async ({ next, request }) => {
  const requestId = request.headers.get('x-nf-request-id') ?? crypto.randomUUID();
  const path = new URL(request.url).pathname;
  let result: Awaited<ReturnType<typeof next>>;
  try {
    result = await next();
  } catch (error) {
    // Rethrow Start control flow (thrown Responses, aborts); handle real failures here so Start's raw fallback logger never sees request data.
    if (error instanceof Response || request.signal.aborted) {
      throw error;
    }
    const response = new Response(null, { status: 500 });
    applyBaselineHeaders(response, requestId);
    logEvent('server_error', { requestId, appEnv, method: request.method, path, status: 500, outcome: 'thrown' });
    return response;
  }

  applyBaselineHeaders(result.response, requestId);
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
