import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { withOwnerContext } from '../../lib/db.server';
import { hostSettingsInput, timeZones } from '../guide/guide-validation';
import { builtInHostSettings, readHostSettings, writeHostSettings } from './settings.server';

export const getHostSettings = createServerFn({ method: 'GET' }).handler(async () =>
  runGuarded(async () => {
    const host = await aal2Host();
    if ('error' in host) return host;
    const settings = await withOwnerContext(host.userId, readHostSettings);
    return { email: host.email, settings: settings ?? builtInHostSettings, saved: settings !== null, timeZones };
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
