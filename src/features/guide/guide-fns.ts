import { createServerFn } from '@tanstack/react-start';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from '../../lib/fn-guards.server';
import { insertAudit } from '../../lib/audit.server';
import { withOwnerContext } from '../../lib/db.server';
import { recordSetupEvent } from '../../lib/setup-events.server';
import {
  copyPropertyInput,
  createSectionInput,
  moveSectionInput,
  previewGuideInput,
  propertyFields,
  propertyIdInput,
  savePropertyInput,
  saveSectionInput,
  setGuidePublishedInput,
} from './guide-validation';
import {
  deleteProperty as deleteOwnedProperty,
  insertCopy,
  insertProperty,
  insertSection,
  moveSection,
  ownsProperty,
  readGuideEditor,
  readGuestGuide,
  readPropertyEssentials,
  setPropertyPublished,
  updateAlertEmail as updateOwnedAlertEmail,
  updateProperty,
  updateSection,
} from './guide.server';

export const createProperty = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { displayName: string; sourceLocale: string; enabledLocales?: string[] })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = propertyFields.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const propertyId = await withOwnerContext(host.userId, (tx) => insertProperty(tx, input.data, host.email));
      await recordSetupEvent(host.userId, 'property_created', { propertyId, step: 'blank' });
      return { propertyId };
    }),
  );

export const copyProperty = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { sourcePropertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = copyPropertyInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const propertyId = await withOwnerContext(host.userId, (tx) => insertCopy(tx, input.data.sourcePropertyId));
      if (!propertyId) return { error: 'invalid_input' } satisfies FnError;
      await recordSetupEvent(host.userId, 'property_created', { propertyId, step: 'copy' });
      return { propertyId };
    }),
  );

export const saveProperty = createServerFn({ method: 'POST' })
  .validator(
    (value: unknown) =>
      value as {
        propertyId: string;
        displayName: string;
        sourceLocale: string;
        enabledLocales?: string[];
        wifiName?: string;
        wifiPassword?: string;
        keyboxCode?: string;
        checkinTime?: string;
        checkoutTime?: string;
        address?: string;
        timezone?: string;
      },
  )
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = savePropertyInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const saved = await withOwnerContext(host.userId, (tx) => updateProperty(tx, input.data));
      if (!saved) return { error: 'invalid_input' } satisfies FnError;
      return { ok: true as const };
    }),
  );

export const deleteProperty = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const deleted = await withOwnerContext(host.userId, async (tx) => {
        if (!(await deleteOwnedProperty(tx, input.data.propertyId))) return false;
        await insertAudit(tx, host.userId, 'delete');
        return true;
      });
      if (!deleted) return { error: 'invalid_input' } satisfies FnError;
      return { ok: true as const };
    }),
  );

export const resyncAlertEmail = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      if (!host.email) return { error: 'invalid_input' } satisfies FnError;
      const email = host.email;
      const updated = await withOwnerContext(host.userId, (tx) =>
        updateOwnedAlertEmail(tx, input.data.propertyId, email),
      );
      if (!updated) return { error: 'invalid_input' } satisfies FnError;
      return { ok: true as const, alertEmail: email };
    }),
  );

export const setGuidePublished = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string; published: boolean })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = setGuidePublishedInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      // Publication and its audit row commit or roll back together; telemetry below stays best-effort.
      const saved = await withOwnerContext(host.userId, async (tx) => {
        const updated = await setPropertyPublished(tx, input.data.propertyId, input.data.published);
        if (!updated) return false;
        await insertAudit(tx, host.userId, input.data.published ? 'publish' : 'unpublish');
        return true;
      });
      if (!saved) return { error: 'invalid_input' } satisfies FnError;
      if (input.data.published) {
        await recordSetupEvent(host.userId, 'publish_clicked', { propertyId: input.data.propertyId });
      }
      return { ok: true as const, published: input.data.published };
    }),
  );

export const createSection = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string; category: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = createSectionInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const sectionId = await withOwnerContext(host.userId, (tx) => insertSection(tx, input.data));
      if (!sectionId) return { error: 'invalid_input' } satisfies FnError;
      return { sectionId };
    }),
  );

export const saveSection = createServerFn({ method: 'POST' })
  .validator(
    (value: unknown) =>
      value as {
        propertyId: string;
        sectionId: string;
        category: string;
        title: string;
        body: string;
        visibility: string;
        secretValue: string;
        published: boolean;
        expectedRevision?: number;
      },
  )
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = saveSectionInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const sourceRevision = await withOwnerContext(host.userId, (tx) => updateSection(tx, input.data));
      if (sourceRevision === null) return { error: 'invalid_input' } satisfies FnError;
      await recordSetupEvent(host.userId, 'section_saved', {
        propertyId: input.data.propertyId,
        step: input.data.category,
      });
      return { ok: true as const, sourceRevision };
    }),
  );

export const moveSectionOrder = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string; sectionId: string; direction: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = moveSectionInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const moved = await withOwnerContext(host.userId, (tx) => moveSection(tx, input.data));
      if (!moved) return { error: 'invalid_input' } satisfies FnError;
      return { ok: true as const };
    }),
  );

export const getPropertyEditor = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      // Reads legitimately run inside SSR loaders (in-process, no JSON/origin headers), so only
      // mutations carry the extra guard; HTTP calls are still covered by the Start CSRF middleware.
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const editor = await withOwnerContext(host.userId, (tx) => readGuideEditor(tx, input.data.propertyId));
      if (!editor) return { error: 'invalid_input' } satisfies FnError;
      return { editor };
    }),
  );

export const getGuestPreview = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string; locale?: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      // Same SSR-loader reasoning as getPropertyEditor: reads skip the mutation guard. The
      // canonical read normalizes the requested locale against the property's enabled set.
      const input = previewGuideInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const preview = await withOwnerContext(host.userId, async (tx) => {
        const guide = await readGuestGuide(tx, input.data.propertyId, input.data.locale ?? null);
        return guide && { ...guide, essentials: await readPropertyEssentials(tx, input.data.propertyId) };
      });
      if (!preview) return { error: 'invalid_input' } satisfies FnError;
      return preview;
    }),
  );

export const recordPreviewOpened = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { propertyId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = propertyIdInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const owned = await withOwnerContext(host.userId, (tx) => ownsProperty(tx, input.data.propertyId));
      if (!owned) return { error: 'invalid_input' } satisfies FnError;
      await recordSetupEvent(host.userId, 'preview_opened', { propertyId: input.data.propertyId });
      return { ok: true as const };
    }),
  );

export const requestSetupSupport = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as Record<string, never>)
  .handler(async () =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      await recordSetupEvent(host.userId, 'support_requested', { step: 'host_home' });
      return { ok: true as const };
    }),
  );
