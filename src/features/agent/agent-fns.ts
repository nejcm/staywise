import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { withOwnerContext } from '../../lib/db.server';
import { serverEnv } from '../../lib/env.server';
import { sendSecurityNotice } from '../../lib/mail.server';
import { createPersonalGrant, readActiveGrants, revokeAllGrants, revokeGrant } from './agent-auth.server';
import { createGrantInput, grantIdInput } from './agent-validation';

const disabled = { error: 'invalid_input' } satisfies FnError;

export const getAgentAccess = createServerFn({ method: 'GET' }).handler(async () =>
  runGuarded(async () => {
    if (serverEnv.agentAccessDisabled) return { enabled: false as const };
    const host = await aal2Host();
    if ('error' in host) return host;
    return withOwnerContext(host.userId, async (tx) => {
      const grants = await readActiveGrants(tx);
      const properties = await tx<{ id: string; name: string }[]>`
        select id, display_name as name from app.properties order by display_name, id
      `;
      return {
        enabled: true as const,
        endpoint: `${serverEnv.appOrigin}/mcp`,
        grants,
        properties: properties.map(({ id, name }) => ({ id, name })),
      };
    });
  }),
);

// AAL2 when TOTP is enrolled or required (Q7); the token is returned once and only its digest is stored.
export const createAgentToken = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as z.input<typeof createGrantInput>)
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation() || serverEnv.agentAccessDisabled) return disabled;
      const input = createGrantInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const { token } = await withOwnerContext(host.userId, (tx) => createPersonalGrant(tx, host.userId, input.data));
      if (host.email) await sendSecurityNotice(host.email, 'agent_grant_created');
      return { ok: true as const, token };
    }),
  );

export const revokeAgentToken = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as z.input<typeof grantIdInput>)
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = grantIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      await withOwnerContext(host.userId, (tx) => revokeGrant(tx, host.userId, input.data.grantId));
      return { ok: true as const };
    }),
  );

export const revokeAllAgentTokens = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as Record<string, never>)
  .handler(async () =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      await withOwnerContext(host.userId, (tx) => revokeAllGrants(tx, host.userId));
      return { ok: true as const };
    }),
  );
