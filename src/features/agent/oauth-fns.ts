import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { withOwnerContext } from '../../lib/db.server';
import { serverEnv } from '../../lib/env.server';
import { applyAuthCookies, isGuardedMutation, requestAuth, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { sendSecurityNotice } from '../../lib/mail.server';
import { aal2Session } from '../auth/auth.server';
import { mcpResource } from './agent-auth.server';
import { approveAuthorization, checkAuthorizeRequest, consentInput, isLoopbackRedirect } from './oauth.server';

const authorizeParams = z.record(z.string().max(64), z.string().max(2000));
const turnedOff = { state: 'error' as const, message: 'Agent access is turned off for this Staywise.' };

async function consentGate() {
  const auth = requestAuth();
  const gate = await aal2Session(auth.client);
  applyAuthCookies(auth, gate.outcome === 'invalid');
  return gate;
}

// Q29: the session gate runs before the client document fetch; approval re-checks the request, never trusting the page.
export const getConsent = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as Record<string, string>)
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (serverEnv.agentAccessDisabled) return turnedOff;
      const params = authorizeParams.safeParse(data);
      if (!params.success) return { state: 'error' as const, message: 'This connection request is malformed.' };
      const gate = await consentGate();
      if (gate.outcome === 'invalid') return { state: 'sign_in' as const };
      if (gate.outcome === 'aal1') return { state: 'verify' as const };
      const request = await checkAuthorizeRequest(params.data);
      if (request.state !== 'ok') return request;
      const properties = await withOwnerContext(
        gate.session.userId,
        (tx) => tx<{ id: string; name: string }[]>`
          select id, display_name as name from app.properties order by display_name, id
        `,
      );
      return {
        state: 'ok' as const,
        clientName: request.client.name,
        clientHost: new URL(request.client.clientId).host,
        redirectHost: new URL(request.redirectUri).host,
        loopback: isLoopbackRedirect(request.redirectUri),
        requestedScopes: request.requestedScopes,
        resource: mcpResource,
        properties: properties.map(({ id, name }) => ({ id, name })),
        denyUrl: request.denyUrl,
      };
    }),
  );

export const approveConsent = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { params: Record<string, string> } & z.input<typeof consentInput>)
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation() || serverEnv.agentAccessDisabled) return { error: 'invalid_input' } satisfies FnError;
      const params = authorizeParams.safeParse(data?.params);
      const consent = consentInput.safeParse(data);
      if (!params.success || !consent.success) return { error: 'invalid_input' } satisfies FnError;
      const gate = await consentGate();
      if (gate.outcome !== 'ok') return { error: 'auth_required' } satisfies FnError;
      const request = await checkAuthorizeRequest(params.data);
      if (request.state !== 'ok') return { error: 'invalid_input' } satisfies FnError;
      const { userId, email } = gate.session;
      const url = await withOwnerContext(userId, (tx) => approveAuthorization(tx, userId, request, consent.data));
      if (email) await sendSecurityNotice(email, 'agent_grant_created');
      return { ok: true as const, url };
    }),
  );
