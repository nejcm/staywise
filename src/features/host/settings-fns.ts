import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import {
  aal2Host,
  isGuardedMutation,
  reportedOrNull,
  runGuarded,
  workspaceHost,
  type FnError,
} from '../../lib/fn-guards.server';
import { readAgentAccess } from '../agent/agent-auth.server';
import { withOwnerContext } from '../../lib/db.server';
import { serverEnv } from '../../lib/env.server';
import { hostSettingsInput, timeZones } from '../guide/guide-validation';
import { builtInHostSettings, readHostSettings, readSecurityActivity, writeHostSettings } from './settings.server';

export const getHostSettings = createServerFn({ method: 'GET' }).handler(async () =>
  runGuarded(async () => {
    const host = await aal2Host();
    if ('error' in host) return host;
    const settings = await withOwnerContext(host.userId, readHostSettings);
    return {
      email: host.email,
      settings: settings ?? builtInHostSettings,
      saved: settings !== null,
      timeZones,
      accountDeletion: serverEnv.supabaseSecretKey !== null,
      supportEnabled: serverEnv.supportEmail !== null,
    };
  }),
);

export const saveHostSettings = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as z.input<typeof hostSettingsInput>)
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = hostSettingsInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      await withOwnerContext(host.userId, (tx) => writeHostSettings(tx, input.data));
      return { ok: true as const };
    }),
  );

export const getSecurityActivity = createServerFn({ method: 'GET' }).handler(async () =>
  runGuarded(async () => {
    const host = await aal2Host();
    if ('error' in host) return host;
    return { events: await withOwnerContext(host.userId, readSecurityActivity) };
  }),
);

// The whole settings page in one round trip: the loader used to chain four server functions, each
// repeating the Auth-server checks and a Netlify function invocation.
export const getSettingsPage = createServerFn({ method: 'GET' }).handler(async () =>
  runGuarded(async () => {
    const host = await workspaceHost();
    if ('redirect' in host) return host;
    // One transaction, queries pipelined; the savepoint keeps a failing security-activity read from aborting the rest.
    const [settings, agent, events] = await withOwnerContext(host.userId, (tx) =>
      Promise.all([
        readHostSettings(tx),
        serverEnv.agentAccessDisabled ? ({ enabled: false } as const) : readAgentAccess(tx),
        reportedOrNull(tx.savepoint(readSecurityActivity)),
      ]),
    );
    return {
      agent,
      securityEvents: events,
      totpFactorIds: host.totpFactorIds,
      email: host.email,
      settings: settings ?? builtInHostSettings,
      saved: settings !== null,
      timeZones,
      accountDeletion: serverEnv.supabaseSecretKey !== null,
    };
  }),
);

export const getHelpPage = createServerFn({ method: 'GET' }).handler(async () =>
  runGuarded(async () => {
    const host = await workspaceHost();
    if ('redirect' in host) return host;
    return { email: host.email, supportEnabled: serverEnv.supportEmail !== null };
  }),
);
