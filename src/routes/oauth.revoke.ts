import { createFileRoute } from '@tanstack/react-router';
import { oauthJson, postOnly, readForm, revokeOAuthToken } from '../features/agent/oauth.server';
import { appEnv, serverEnv } from '../lib/env.server';
import { logEvent } from '../lib/log.server';

export const Route = createFileRoute('/oauth/revoke')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (serverEnv.agentAccessDisabled) return oauthJson(503, { error: 'temporarily_unavailable' });
          const form = await readForm(request);
          if (!form) return oauthJson(400, { error: 'invalid_request' });
          await revokeOAuthToken(form);
          return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
        } catch {
          logEvent('server_error', { appEnv, path: '/oauth/revoke', status: 500 });
          return oauthJson(500, { error: 'server_error' });
        }
      },
      GET: postOnly,
    },
  },
});
