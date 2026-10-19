import { createServerFn } from '@tanstack/react-start';
import { insertAudit } from '../../lib/audit.server';
import { withOwnerContext } from '../../lib/db.server';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { propertyIdInput } from '../guide/guide-validation';
import { disableShareLink, insertShareLink, newShareLink, readShareLinkState, rotateShareLink } from './share.server';

// Host guest-link controls. Issuance, rotation, and disabling write their audit row in the same
// transaction, so a link state change without its audit record cannot commit.

export const getGuestLink = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      // Reads legitimately run inside SSR loaders (in-process, no JSON/origin headers), so only
      // mutations carry the extra guard; HTTP calls are still covered by the Start CSRF middleware.
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const share = await withOwnerContext(host.userId, (tx) => readShareLinkState(tx, input.data.propertyId));
      if (!share) return { error: 'invalid_input' } satisfies FnError;
      return { share };
    }),
  );

export const createGuestLink = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const link = newShareLink();
      const created = await withOwnerContext(host.userId, async (tx) => {
        if (!(await insertShareLink(tx, { propertyId: input.data.propertyId, id: link.id, hmac: link.hmac }))) {
          return false;
        }
        await insertAudit(tx, host.userId, 'link_created');
        return true;
      });
      if (!created) return { error: 'invalid_input' } satisfies FnError;
      // The secret is returned once, here; the database holds only its HMAC.
      return { shareId: link.id, secret: link.secret };
    }),
  );

export const rotateGuestLink = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const link = newShareLink();
      const rotated = await withOwnerContext(host.userId, async (tx) => {
        if (!(await rotateShareLink(tx, { propertyId: input.data.propertyId, id: link.id, hmac: link.hmac }))) {
          return false;
        }
        await insertAudit(tx, host.userId, 'link_rotated');
        return true;
      });
      if (!rotated) return { error: 'invalid_input' } satisfies FnError;
      return { shareId: link.id, secret: link.secret };
    }),
  );

export const disableGuestLink = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const disabled = await withOwnerContext(host.userId, async (tx) => {
        if (!(await disableShareLink(tx, input.data.propertyId))) return false;
        await insertAudit(tx, host.userId, 'link_disabled');
        return true;
      });
      if (!disabled) return { error: 'invalid_input' } satisfies FnError;
      return { ok: true as const };
    }),
  );
