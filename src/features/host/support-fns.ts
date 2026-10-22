import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { withOwnerContext } from '../../lib/db.server';
import { supportReportInput } from '../guide/guide-validation';

export const submitSupportReport = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as z.input<typeof supportReportInput>)
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = supportReportInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      await withOwnerContext(
        host.userId,
        (tx) =>
          tx`insert into app.support_reports (owner_id, kind, message) values (${host.userId}, ${input.data.kind}, ${input.data.message})`,
      );
      return { ok: true as const };
    }),
  );
