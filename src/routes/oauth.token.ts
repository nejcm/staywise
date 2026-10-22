import { createFileRoute } from '@tanstack/react-router';
import { agentFailuresExceeded, recordAgentFailure } from '../features/agent/agent-auth.server';
import { exchangeToken, oauthJson, postOnly, readForm } from '../features/agent/oauth.server';
import { appEnv, serverEnv } from '../lib/env.server';
import { logEvent } from '../lib/log.server';

export const Route = createFileRoute('/oauth/token')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (serverEnv.agentAccessDisabled) return oauthJson(503, { error: 'temporarily_unavailable' });
          const clientIp = request.headers.get('x-nf-client-connection-ip');
          if (await agentFailuresExceeded(clientIp)) {
            return oauthJson(429, { error: 'rate_limited' }, { 'retry-after': '60' });
          }
          const form = await readForm(request);
          if (!form) return oauthJson(400, { error: 'invalid_request' });
          const result = await exchangeToken(form);
          if (result.status === 400 && result.body.error === 'invalid_grant') await recordAgentFailure(clientIp);
          return oauthJson(result.status, result.body);
        } catch {
          logEvent('server_error', { appEnv, path: '/oauth/token', status: 500 });
          return oauthJson(500, { error: 'server_error' });
        }
      },
      GET: postOnly,
    },
  },
});
