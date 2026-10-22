import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { serverEnv } from '../../lib/env.server';
import { sendSupportRequest } from '../../lib/mail.server';
import { supportRequestInput } from '../guide/guide-validation';
import { supportRequestAllowed } from './support.server';

export const submitSupportRequest = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as z.input<typeof supportRequestInput>)
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation() || !serverEnv.supportEmail) return { error: 'invalid_input' } satisfies FnError;
      const input = supportRequestInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      if (!host.email) return { error: 'unexpected' } satisfies FnError;
      if (!(await supportRequestAllowed(host.userId))) return { error: 'unexpected' } satisfies FnError;
      const sent = await sendSupportRequest({ hostEmail: host.email, ...input.data });
      return sent ? { ok: true as const } : ({ error: 'unexpected' } satisfies FnError);
    }),
  );
