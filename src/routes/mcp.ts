import { createMcpHandler } from '@modelcontextprotocol/server';
import { createFileRoute } from '@tanstack/react-router';
import { agentServer } from '../features/agent/agent-tools.server';
import { agentRequestAllowed, bearerToken, resolveAgentToken } from '../features/agent/agent-auth.server';
import { appEnv, serverEnv } from '../lib/env.server';
import { logEvent } from '../lib/log.server';

const MCP_BODY_MAX = 64 * 1024;
const appOrigin = new URL(serverEnv.appOrigin);
const noStore = { 'cache-control': 'no-store' };

function denial(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { ...noStore, ...headers } });
}

// Browser-reachable endpoint: only this deploy's Host, and no cross-origin page, before any auth (Q25).
function trustedRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  return request.headers.get('host') === appOrigin.host && (origin === null || origin === appOrigin.origin);
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: 'POST', ...noStore } });

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!trustedRequest(request)) return denial(403, 'forbidden');
          const principal = await resolveAgentToken(
            bearerToken(request.headers.get('authorization')),
            request.headers.get('user-agent'),
          );
          if (!principal) return denial(401, 'invalid_token', { 'www-authenticate': 'Bearer error="invalid_token"' });
          if (!(await agentRequestAllowed(principal))) return denial(429, 'rate_limited', { 'retry-after': '60' });
          const handler = createMcpHandler(() => agentServer(principal), {
            responseMode: 'json',
            maxRequestBodySize: MCP_BODY_MAX,
            onerror: () => logEvent('server_error', { appEnv, path: '/mcp', outcome: 'mcp_handler' }),
          });
          const response = await handler.fetch(request);
          response.headers.set('cache-control', 'no-store');
          return response;
        } catch {
          logEvent('server_error', { appEnv, path: '/mcp', status: 500 });
          return denial(500, 'server_error');
        }
      },
      GET: notAllowed,
      DELETE: notAllowed,
    },
  },
});
