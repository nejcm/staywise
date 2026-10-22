import { createMcpHandler } from '@modelcontextprotocol/server';
import { createFileRoute } from '@tanstack/react-router';
import { agentServer, toolScopes } from '../features/agent/agent-tools.server';
import {
  agentFailuresExceeded,
  agentRequestAllowed,
  bearerToken,
  recordAgentFailure,
  resolveAgentToken,
  type AgentPrincipal,
} from '../features/agent/agent-auth.server';
import type { AgentScope } from '../features/agent/agent-validation';
import { resourceMetadataUrl } from '../features/agent/oauth.server';
import { readBoundedBytes } from '../features/messages/message-validation';
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

// OAuth clients step up on 403 insufficient_scope; personal tokens keep the JSON-RPC tool error (Q25).
async function missingScope(request: Request, principal: AgentPrincipal): Promise<AgentScope | null> {
  if (principal.kind !== 'oauth') return null;
  const body = await readBoundedBytes(request.clone().body, MCP_BODY_MAX);
  if (body.state !== 'ok') return null;
  try {
    const message = JSON.parse(new TextDecoder().decode(body.bytes)) as {
      method?: unknown;
      params?: { name?: unknown };
    };
    const name = message.method === 'tools/call' ? message.params?.name : undefined;
    const scope = typeof name === 'string' ? toolScopes.get(name) : undefined;
    return scope && !principal.scopes.includes(scope) ? scope : null;
  } catch {
    return null;
  }
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: 'POST', ...noStore } });

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!trustedRequest(request)) return denial(403, 'forbidden');
          const clientIp = request.headers.get('x-nf-client-connection-ip');
          if (await agentFailuresExceeded(clientIp)) return denial(429, 'rate_limited', { 'retry-after': '60' });
          const bearer = bearerToken(request.headers.get('authorization'));
          const principal = await resolveAgentToken(bearer, request.headers.get('user-agent'));
          if (!principal) {
            await recordAgentFailure(clientIp);
            const error = bearer ? 'error="invalid_token", ' : '';
            return denial(401, 'invalid_token', {
              'www-authenticate': `Bearer ${error}scope="read", resource_metadata="${resourceMetadataUrl}"`,
            });
          }
          if (!(await agentRequestAllowed(principal))) return denial(429, 'rate_limited', { 'retry-after': '60' });
          const scope = await missingScope(request, principal);
          if (scope) {
            return denial(403, 'insufficient_scope', {
              'www-authenticate': `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${resourceMetadataUrl}"`,
            });
          }
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
