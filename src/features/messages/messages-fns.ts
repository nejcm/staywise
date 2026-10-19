import { createServerFn } from '@tanstack/react-start';
import { insertAudit } from '../../lib/audit.server';
import { withOwnerContext } from '../../lib/db.server';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { inboxInput, messageActionInput, setAnswerInGuideInput } from './message-validation';
import { deleteMessage, markMessageHandled, readInbox, setMessageAnswerInGuide } from './messages.server';

// Host inbox server functions: reads run inside SSR loaders, mutations carry the JSON/origin guard,
// and handled/deleted rows write their audit record in the same transaction as the change.

export const getInbox = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      const input = inboxInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      return { messages: await withOwnerContext(host.userId, (tx) => readInbox(tx, input.data.propertyId)) };
    }),
  );

export const markInboxHandled = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string; messageId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = messageActionInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const changed = await withOwnerContext(host.userId, async (tx) => {
        if (!(await markMessageHandled(tx, input.data))) return false;
        await insertAudit(tx, host.userId, 'message_handled');
        return true;
      });
      return { ok: changed };
    }),
  );

// The answer tag is a host action like the state changes: a successful change commits its own audit
// row in the same transaction, a repeated value or a denied target changes and audits nothing.
export const tagInboxAnswer = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string; messageId: string; answerInGuide: boolean })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = setAnswerInGuideInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const changed = await withOwnerContext(host.userId, async (tx) => {
        if (!(await setMessageAnswerInGuide(tx, input.data))) return false;
        await insertAudit(tx, host.userId, 'message_tagged');
        return true;
      });
      return { ok: changed };
    }),
  );

export const deleteInboxMessage = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string; messageId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = messageActionInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const changed = await withOwnerContext(host.userId, async (tx) => {
        if (!(await deleteMessage(tx, input.data))) return false;
        await insertAudit(tx, host.userId, 'message_deleted');
        return true;
      });
      return { ok: changed };
    }),
  );
