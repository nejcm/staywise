import { createServerFn } from '@tanstack/react-start';
import { aal2Host, isGuardedMutation, runGuarded, type FnError } from './fn-guards.server';
import { insertAudit } from './audit.server';
import { withOwnerContext } from './db.server';
import { recordSetupEvent } from './setup-events.server';
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
  insertCopy,
  insertProperty,
  insertSection,
  moveSection,
  ownsProperty,
  readGuideEditor,
  readGuestGuide,
  setPropertyPublished,
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
      const propertyId = await withOwnerContext(host.userId, (tx) => insertProperty(tx, input.data));
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
      value as { propertyId: string; displayName: string; sourceLocale: string; enabledLocales?: string[] },
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
      },
  )
  .handler(async ({ data }) =>
    runGuarded(async () => {
      if (!isGuardedMutation()) return { error: 'invalid_input' } satisfies FnError;
      const input = saveSectionInput.safeParse(data);
      if (!input.success) return { error: 'invalid_input' } satisfies FnError;
      const host = await aal2Host();
      if ('error' in host) return host;
      const saved = await withOwnerContext(host.userId, (tx) => updateSection(tx, input.data));
      if (!saved) return { error: 'invalid_input' } satisfies FnError;
      await recordSetupEvent(host.userId, 'section_saved', {
        propertyId: input.data.propertyId,
        step: input.data.category,
      });
      return { ok: true as const };
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
      const preview = await withOwnerContext(host.userId, (tx) =>
        readGuestGuide(tx, input.data.propertyId, input.data.locale ?? null),
      );
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
