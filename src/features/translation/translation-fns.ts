import { createServerFn } from '@tanstack/react-start';
import { insertAudit } from '../../lib/audit.server';
import { withOwnerContext } from '../../lib/db.server';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { approveTranslationInput, propertyIdInput, translationInput } from '../guide/guide-validation';
import { approveTranslation, generateTranslations, rejectTranslation } from './translation.server';

// Host translation controls. Generation spends provider egress through the single allowlisted
// module; approval and rejection commit their audit row in the same transaction as the write.

export const generateGuideTranslations = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const outcome = await generateTranslations({ propertyId: input.data.propertyId, actorId: host.userId });
      if (outcome.state === 'invalid_input') return { error: 'invalid_input' } satisfies FnError;
      return outcome;
    }),
  );

export const approveGuideTranslation = createServerFn({ method: 'POST' })
  .validator(
    (value: unknown) =>
      value as { propertyId: string; translationId: string; sourceRevision: number; title: string; body: string },
  )
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = approveTranslationInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const approved = await withOwnerContext(host.userId, async (tx) => {
        if (!(await approveTranslation(tx, input.data))) return false;
        await insertAudit(tx, host.userId, 'translation_approved');
        return true;
      });
      if (!approved) return { error: 'invalid_input' } satisfies FnError;
      return { ok: true as const };
    }),
  );

export const rejectGuideTranslation = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string; translationId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = translationInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const rejected = await withOwnerContext(host.userId, async (tx) => {
        if (!(await rejectTranslation(tx, input.data))) return false;
        await insertAudit(tx, host.userId, 'translation_rejected');
        return true;
      });
      if (!rejected) return { error: 'invalid_input' } satisfies FnError;
      return { ok: true as const };
    }),
  );
