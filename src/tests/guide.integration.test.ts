// Phase 3 guide-authoring trust boundaries against the real local stack and dev server.
// Requires `bun run db:start` and `bun run dev`; runs inside `bun run test` and skips without them.
// Run directly with: bun run test:local (synthetic data only; never a remote environment).
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServerClient } from '@supabase/ssr';
import { afterAll, describe, expect, it } from 'vitest';
import { sql, withLinkContext, withOwnerContext } from '../lib/db.server';
import {
  insertProperty,
  insertSection,
  moveSection,
  readGuideEditor,
  updateProperty,
  updateSection,
} from '../features/guide/guide.server';
import type { SectionCategory } from '../features/guide/guide-validation';
import {
  GUIDE_FNS,
  HOST_FNS,
  SYNTHETIC_PASSWORD,
  adminClient,
  decode,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  fnCall,
  localAdmin,
  quoteLiteral,
  verifiedHost,
  type LocalStack,
  type VerifiedHost,
} from './integration-helpers';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp ? describe : describe.skip;

// The dev server's log file is an orchestration artifact; the forced-failure log assertions skip
// when it is absent (for example when the server logs to a terminal).
function devServerLogBytes(): string | null {
  const path = fileURLToPath(new URL('../../.git/orchestration/dev-server.log', import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

async function waitForLogSlice(before: number, needle: string): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const log = devServerLogBytes();
    if (log === null) return null;
    const slice = log.slice(before);
    if (slice.includes(needle)) return slice;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return devServerLogBytes()?.slice(before) ?? null;
}

afterAll(async () => {
  await sql.end({ timeout: 0 });
});

const guideFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(GUIDE_FNS, name, options);
const hostFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(HOST_FNS, name, options);

async function createProperty(host: VerifiedHost): Promise<string> {
  const created = decode<{ propertyId: string }>(
    await guideFn('createProperty', {
      jar: host.jar,
      data: { displayName: 'Guide integration villa (synthetic)', sourceLocale: 'en' },
    }),
  )?.result;
  if (!created?.propertyId) throw new Error('synthetic property creation failed');
  return created.propertyId;
}

async function createSection(host: VerifiedHost, propertyId: string, category: string): Promise<string> {
  const created = decode<{ sectionId: string }>(
    await guideFn('createSection', { jar: host.jar, data: { propertyId, category } }),
  )?.result;
  if (!created?.sectionId) throw new Error('synthetic section creation failed');
  return created.sectionId;
}

function sectionData(propertyId: string, sectionId: string, overrides: Record<string, unknown> = {}) {
  return {
    propertyId,
    sectionId,
    category: 'wifi',
    title: 'Synthetic Wi-Fi',
    body: 'Synthetic guide body',
    visibility: 'guest',
    secretValue: '',
    published: false,
    ...overrides,
  };
}

describeLocal('guide authoring trust boundaries against the local stack', () => {
  it('keeps drafts, host notes, and secrets out of the guest preview DTO', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'dto');
    try {
      const propertyId = await createProperty(host);
      const renamed = await guideFn('saveProperty', {
        jar: host.jar,
        data: { propertyId, displayName: 'Synthetic renamed villa', sourceLocale: 'en' },
      });
      expect(decode(renamed)?.result).toEqual({ ok: true });

      const sectionId = await createSection(host, propertyId, 'wifi');
      const draft = await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, sectionId, { body: 'SYNTHETIC-DRAFT-BODY' }),
      });
      expect(decode(draft)?.result).toMatchObject({ ok: true });

      const beforePublish = await guideFn('getGuestPreview', { jar: host.jar, data: { propertyId } });
      expect(decode(beforePublish)?.result).toEqual({
        guest: {
          displayName: 'Synthetic renamed villa',
          sourceLocale: 'en',
          locale: 'en',
          locales: ['en'],
          sections: [],
        },
        guidePublished: false,
        essentials: {
          wifiName: null,
          wifiPassword: null,
          keyboxCode: null,
          checkinTime: null,
          checkoutTime: null,
          address: null,
        },
      });

      await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, sectionId, { body: 'SYNTHETIC-DRAFT-BODY', published: true }),
      });
      const noteId = await createSection(host, propertyId, 'emergency');
      await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, noteId, {
          category: 'emergency',
          title: 'Synthetic private note',
          body: 'SYNTHETIC-NOTE-BODY',
          visibility: 'host',
          secretValue: 'SYNTHETIC-SECRET-CODE',
        }),
      });

      const preview = await guideFn('getGuestPreview', { jar: host.jar, data: { propertyId } });
      expect(decode(preview)?.result).toEqual({
        guest: {
          displayName: 'Synthetic renamed villa',
          sourceLocale: 'en',
          locale: 'en',
          locales: ['en'],
          sections: [
            { category: 'wifi', title: 'Synthetic Wi-Fi', body: 'SYNTHETIC-DRAFT-BODY', provenance: 'source' },
          ],
        },
        guidePublished: false,
        essentials: {
          wifiName: null,
          wifiPassword: null,
          keyboxCode: null,
          checkinTime: null,
          checkoutTime: null,
          address: null,
        },
      });
      for (const leak of ['SYNTHETIC-NOTE-BODY', 'SYNTHETIC-SECRET-CODE']) {
        expect(preview.body).not.toContain(leak);
      }

      type EditorSection = { id: string; secretValue: string | null; sourceRevision: number; published: boolean };
      const editor = decode<{ editor: { sections: EditorSection[] } }>(
        await guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId } }),
      )?.result?.editor;
      expect(editor?.sections.find((section) => section.id === noteId)?.secretValue).toBe('SYNTHETIC-SECRET-CODE');
      expect(editor?.sections.find((section) => section.id === sectionId)?.sourceRevision).toBe(2);

      // Guest prose edits bump the source revision; publishing without an edit does not.
      await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, sectionId, { body: 'SYNTHETIC-DRAFT-BODY v2', published: true }),
      });
      const after = decode<{ editor: { sections: EditorSection[] } }>(
        await guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId } }),
      )?.result?.editor;
      expect(after?.sections.find((section) => section.id === sectionId)?.sourceRevision).toBe(3);

      const admin = localAdmin();
      try {
        const events = await admin<{ event_type: string; step: string | null }[]>`
          select event_type, step from app.setup_events where owner_id = ${host.userId}
        `;
        expect(events.filter((event) => event.event_type === 'property_created').map((event) => event.step)).toEqual([
          'blank',
        ]);
        expect(
          events
            .filter((event) => event.event_type === 'section_saved')
            .map((event) => event.step)
            .sort(),
        ).toEqual(['emergency', 'wifi', 'wifi', 'wifi']);
        const [leaks] = await admin<{ n: number }[]>`
          select count(*)::int as n from app.setup_events
          where owner_id = ${host.userId} and coalesce(step, '') like '%SYNTHETIC%'
        `;
        expect(leaks?.n).toBe(0);
      } finally {
        await admin.end({ timeout: 0 });
      }
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('copies a guide as independent drafts without duplicating secrets', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'copy');
    try {
      const propertyId = await createProperty(host);
      const sectionId = await createSection(host, propertyId, 'wifi');
      await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, sectionId, { body: 'Synthetic copy body', published: true }),
      });
      const noteId = await createSection(host, propertyId, 'emergency');
      await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, noteId, {
          category: 'emergency',
          visibility: 'host',
          secretValue: 'SYNTHETIC-COPY-SECRET',
        }),
      });

      const copied = decode<{ propertyId: string }>(
        await guideFn('copyProperty', { jar: host.jar, data: { sourcePropertyId: propertyId } }),
      )?.result?.propertyId;
      type CopiedSection = { id: string; body: string; published: boolean; secretValue: string | null };
      type CopiedEditor = { property: { displayName: string; published: boolean }; sections: CopiedSection[] };
      const copyEditor = decode<{ editor: CopiedEditor }>(
        await guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId: copied } }),
      )?.result?.editor;
      expect(copyEditor?.property.displayName).toBe('Guide integration villa (synthetic) (copy)');
      expect(copyEditor?.property.published).toBe(false);
      expect(copyEditor?.sections).toHaveLength(2);
      expect(copyEditor?.sections.every((section) => section.published === false)).toBe(true);
      expect(copyEditor?.sections.every((section) => section.secretValue === null)).toBe(true);
      expect(copyEditor?.sections.some((section) => section.body === 'Synthetic copy body')).toBe(true);

      await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, sectionId, { body: 'Synthetic changed after copy', published: true }),
      });
      const original = decode<{ editor: CopiedEditor }>(
        await guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId } }),
      )?.result?.editor;
      const copyAfter = decode<{ editor: CopiedEditor }>(
        await guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId: copied } }),
      )?.result?.editor;
      expect(original?.sections.find((section) => section.id === sectionId)?.body).toBe('Synthetic changed after copy');
      expect(copyAfter?.sections.some((section) => section.body === 'Synthetic copy body')).toBe(true);
      expect(copyAfter?.sections.some((section) => section.body === 'Synthetic changed after copy')).toBe(false);

      const copyPreview = decode<{ guest: { sections: unknown[] } }>(
        await guideFn('getGuestPreview', { jar: host.jar, data: { propertyId: copied } }),
      )?.result;
      expect(copyPreview?.guest.sections).toEqual([]);

      const admin = localAdmin();
      try {
        const events = await admin<{ step: string | null }[]>`
          select step from app.setup_events where owner_id = ${host.userId} and event_type = 'property_created'
        `;
        expect(events.map((event) => event.step).sort()).toEqual(['blank', 'copy']);
      } finally {
        await admin.end({ timeout: 0 });
      }
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('audits publish and unpublish, and the guest order follows the editor', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'publish');
    try {
      const propertyId = await createProperty(host);
      const first = await createSection(host, propertyId, 'wifi');
      await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, first, { body: 'Synthetic wifi body', published: true }),
      });
      const second = await createSection(host, propertyId, 'parking');
      await guideFn('saveSection', {
        jar: host.jar,
        data: sectionData(propertyId, second, { category: 'parking', body: 'Synthetic parking body', published: true }),
      });

      const published = await guideFn('setGuidePublished', {
        jar: host.jar,
        data: { propertyId, published: true },
      });
      expect(decode(published)?.result).toEqual({ ok: true, published: true });
      const unpublished = await guideFn('setGuidePublished', {
        jar: host.jar,
        data: { propertyId, published: false },
      });
      expect(decode(unpublished)?.result).toEqual({ ok: true, published: false });

      const moved = await guideFn('moveSectionOrder', {
        jar: host.jar,
        data: { propertyId, sectionId: second, direction: 'up' },
      });
      expect(decode(moved)?.result).toEqual({ ok: true });
      const edged = await guideFn('moveSectionOrder', {
        jar: host.jar,
        data: { propertyId, sectionId: second, direction: 'up' },
      });
      expect(decode(edged)?.result).toEqual({ ok: true });

      const preview = decode<{ guest: { sections: { category: string }[] } }>(
        await guideFn('getGuestPreview', { jar: host.jar, data: { propertyId } }),
      )?.result;
      expect(preview?.guest.sections.map((section) => section.category)).toEqual(['parking', 'wifi']);

      const admin = localAdmin();
      try {
        const audit = await admin<{ action: string }[]>`
          select action from app.audit_events
          where actor_id = ${host.userId} and action in ('publish', 'unpublish')
          order by id
        `;
        expect(audit.map((row) => row.action)).toEqual(['publish', 'unpublish']);
        const events = await admin<{ event_type: string; property_id: string; step: string | null }[]>`
          select event_type, property_id, step from app.setup_events where owner_id = ${host.userId}
        `;
        const clicks = events.filter((event) => event.event_type === 'publish_clicked');
        expect(clicks).toHaveLength(1);
        expect(clicks[0]?.property_id).toBe(propertyId);
        expect(clicks[0]?.step).toBeNull();
      } finally {
        await admin.end({ timeout: 0 });
      }
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('denies cross-owner, anonymous, and AAL1 calls at the server boundary', async () => {
    const local = localStack as LocalStack;
    const owner = await verifiedHost(local, 'owner');
    const intruder = await verifiedHost(local, 'intruder');
    try {
      const propertyId = await createProperty(owner);
      const sectionId = await createSection(owner, propertyId, 'wifi');
      await guideFn('saveSection', {
        jar: owner.jar,
        data: sectionData(propertyId, sectionId, { body: 'SYNTHETIC-OWNER-BODY', published: true }),
      });

      const crossOwnerCalls = [
        () =>
          guideFn('saveProperty', {
            jar: intruder.jar,
            data: { propertyId, displayName: 'Synthetic takeover', sourceLocale: 'en' },
          }),
        () =>
          guideFn('saveSection', {
            jar: intruder.jar,
            data: sectionData(propertyId, sectionId, { body: 'Synthetic takeover', published: true }),
          }),
        () => guideFn('setGuidePublished', { jar: intruder.jar, data: { propertyId, published: true } }),
        () => guideFn('getPropertyEditor', { jar: intruder.jar, data: { propertyId } }),
        () => guideFn('getGuestPreview', { jar: intruder.jar, data: { propertyId } }),
        () => guideFn('createSection', { jar: intruder.jar, data: { propertyId, category: 'wifi' } }),
        () => guideFn('recordPreviewOpened', { jar: intruder.jar, data: { propertyId } }),
      ];
      for (const call of crossOwnerCalls) {
        const reply = await call();
        expect(decode<{ error?: string }>(reply)?.result?.error).toBeDefined();
        expect(reply.body).not.toContain('SYNTHETIC-OWNER-BODY');
      }

      const anonymous = await guideFn('getGuestPreview', { data: { propertyId } });
      expect(decode<{ error?: string }>(anonymous)?.result?.error).toBe('auth_required');
      expect(anonymous.body).not.toContain('SYNTHETIC-OWNER-BODY');

      // AAL1 after a fresh sign-in: denied, and the valid session survives for the step-up.
      await hostFn('signOut', { jar: intruder.jar, data: {} });
      const client = createServerClient(local.apiUrl, local.anonKey, {
        cookies: { getAll: intruder.jar.getAll, setAll: intruder.jar.setAll },
      });
      await client.auth.signInWithPassword({ email: intruder.email, password: SYNTHETIC_PASSWORD });
      const aal1 = await guideFn('saveSection', {
        jar: intruder.jar,
        data: sectionData(propertyId, sectionId, { body: 'Synthetic takeover', published: true }),
      });
      expect(decode<{ error?: string }>(aal1)?.result?.error).toBe('auth_required');
      expect(
        aal1.setCookies.some((header) => /^sb-.*-auth-token(\.\d+)?=;/.test(header) && header.includes('Max-Age=0')),
      ).toBe(false);
      expect(intruder.jar.sessionCount()).toBeGreaterThan(0);

      const admin = localAdmin();
      try {
        const [property] = await admin<{ display_name: string; published: boolean }[]>`
          select display_name, published from app.properties where id = ${propertyId}
        `;
        expect(property?.display_name).toBe('Guide integration villa (synthetic)');
        expect(property?.published).toBe(false);
        const [events] = await admin<{ n: number }[]>`
          select count(*)::int as n from app.setup_events where owner_id = ${intruder.userId}
        `;
        expect(events?.n).toBe(0);
      } finally {
        await admin.end({ timeout: 0 });
      }
    } finally {
      await adminClient(local).deleteUser(owner.userId);
      await adminClient(local).deleteUser(intruder.userId);
    }
  }, 90_000);

  it('deletes a property and every child immediately, and resyncs the alert address on demand', async () => {
    const local = localStack as LocalStack;
    const owner = await verifiedHost(local, 'delete-owner');
    const intruder = await verifiedHost(local, 'delete-intruder');
    const admin = localAdmin();
    try {
      const propertyId = await createProperty(owner);
      const sectionId = await createSection(owner, propertyId, 'wifi');
      const linkId = `itc7${Date.now()}`;
      const messageId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const translationId = crypto.randomUUID();
      const reservationId = crypto.randomUUID();
      const tokenId = crypto.randomUUID();
      await admin`
        insert into app.guide_translations (id, section_id, locale, title, body, source_revision, state, provider)
        values (${translationId}, ${sectionId}, 'de', 'Synthetic', 'Synthetic', 1, 'approved', 'synthetic')
      `;
      await admin`
        insert into app.share_links (id, secret_hmac, property_id) values (${linkId}, ${Buffer.from('0102', 'hex')}, ${propertyId})
      `;
      await admin`
        insert into app.guest_sessions (id, session_hash, share_link_id, expires_at)
        values (${sessionId}, ${Buffer.from('11', 'hex')}, ${linkId}, now() + interval '1 hour')
      `;
      await admin`
        insert into app.guest_messages (id, property_id, kind, category, body)
        values (${messageId}, ${propertyId}, 'question', 'wifi', 'Synthetic delete body')
      `;
      await admin`
        insert into app.rate_limits (property_id, key_hash, window_start, count) values
          (${propertyId}, ${crypto.randomBytes(16)}, now(), 1),
          (${propertyId}, ${crypto.randomBytes(16)}, now(), 1)
      `;
      await admin`
        insert into app.guest_counters (property_id, day, link_exchanges, guide_opens, submissions)
        values (${propertyId}, current_date, 1, 1, 1)
      `;
      await admin`
        insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end)
        values (${reservationId}, ${propertyId}, 'synthetic', ${reservationId}, current_date, current_date)
      `;
      await admin`
        insert into app.setup_events (owner_id, event_type, property_id, step)
        values (${owner.userId}, 'section_saved', ${propertyId}, 'wifi')
      `;
      await admin`
        insert into app.api_tokens (id, owner_id, token_hash, scopes, property_id)
        values (${tokenId}, ${owner.userId}, ${crypto.randomBytes(16)}, '{content:write}', ${propertyId})
      `;

      const [before] = await admin<{ alert_email: string | null }[]>`
        select alert_email from app.properties where id = ${propertyId}
      `;
      expect(before?.alert_email).toBe(owner.email);
      const newEmail = `synthetic-delete-owner-updated-${Date.now()}@example.test`;
      await adminClient(local).updateUserEmail(owner.userId, newEmail);
      const resynced = decode<{ ok?: boolean; alertEmail?: string }>(
        await guideFn('resyncAlertEmail', { jar: owner.jar, data: { propertyId } }),
      )?.result;
      expect(resynced).toEqual({ ok: true, alertEmail: newEmail });
      const [after] = await admin<{ alert_email: string | null }[]>`
        select alert_email from app.properties where id = ${propertyId}
      `;
      expect(after?.alert_email).toBe(newEmail);

      const crossOwner = await guideFn('deleteProperty', { jar: intruder.jar, data: { propertyId } });
      expect(decode<{ error?: string }>(crossOwner)?.result?.error).toBe('invalid_input');
      const [stillThere] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.properties where id = ${propertyId}
      `;
      expect(stillThere?.n).toBe(1);

      const deleted = await guideFn('deleteProperty', { jar: owner.jar, data: { propertyId } });
      expect(decode<{ ok?: boolean }>(deleted)?.result).toEqual({ ok: true });
      const [children] = await admin<
        {
          properties: number;
          sections: number;
          translations: number;
          links: number;
          sessions: number;
          messages: number;
          rates: number;
          counters: number;
          reservations: number;
          setup_events: number;
          api_tokens: number;
          delete_audits: number;
        }[]
      >`
        select
          (select count(*)::int from app.properties where id = ${propertyId}) as properties,
          (select count(*)::int from app.guide_sections where property_id = ${propertyId}) as sections,
          (select count(*)::int from app.guide_translations where id = ${translationId}) as translations,
          (select count(*)::int from app.share_links where property_id = ${propertyId}) as links,
          (select count(*)::int from app.guest_sessions where id = ${sessionId}) as sessions,
          (select count(*)::int from app.guest_messages where id = ${messageId}) as messages,
          (select count(*)::int from app.rate_limits where property_id = ${propertyId}) as rates,
          (select count(*)::int from app.guest_counters where property_id = ${propertyId}) as counters,
          (select count(*)::int from app.reservations where id = ${reservationId}) as reservations,
          (select count(*)::int from app.setup_events where property_id = ${propertyId}) as setup_events,
          (select count(*)::int from app.api_tokens where id = ${tokenId}) as api_tokens,
          (select count(*)::int from app.audit_events where actor_id = ${owner.userId} and action = 'delete') as delete_audits
      `;
      expect(children).toEqual({
        properties: 0,
        sections: 0,
        translations: 0,
        links: 0,
        sessions: 0,
        messages: 0,
        rates: 0,
        counters: 0,
        reservations: 0,
        setup_events: 0,
        api_tokens: 0,
        delete_audits: 1,
      });
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(owner.userId);
      await adminClient(local).deleteUser(intruder.userId);
    }
  }, 90_000);

  it('refuses a section save made against an older revision', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'conflict');
    try {
      const propertyId = await createProperty(host);
      const sectionId = await createSection(host, propertyId, 'wifi');
      const admin = localAdmin();
      try {
        const [loaded] = await admin<{ source_revision: number }[]>`
          select source_revision from app.guide_sections where id = ${sectionId}
        `;
        const first = decode<{ ok?: boolean; sourceRevision?: number }>(
          await guideFn('saveSection', {
            jar: host.jar,
            data: sectionData(propertyId, sectionId, { expectedRevision: loaded!.source_revision, body: 'Tab B body' }),
          }),
        )?.result;
        expect(first).toMatchObject({ ok: true, sourceRevision: loaded!.source_revision + 1 });

        const stale = decode<{ error?: string }>(
          await guideFn('saveSection', {
            jar: host.jar,
            data: sectionData(propertyId, sectionId, { expectedRevision: loaded!.source_revision, body: 'Tab A body' }),
          }),
        )?.result;
        expect(stale?.error).toBe('invalid_input');
        const [kept] = await admin<{ body: string }[]>`select body from app.guide_sections where id = ${sectionId}`;
        expect(kept?.body).toBe('Tab B body');

        const current = decode<{ ok?: boolean }>(
          await guideFn('saveSection', {
            jar: host.jar,
            data: sectionData(propertyId, sectionId, { expectedRevision: first!.sourceRevision, body: 'Tab A body' }),
          }),
        )?.result;
        expect(current?.ok).toBe(true);
      } finally {
        await admin.end({ timeout: 0 });
      }
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('rejects malformed and oversized guide input before any write', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'invalid');
    try {
      const propertyId = await createProperty(host);
      const sectionId = await createSection(host, propertyId, 'wifi');

      const rejected = [
        guideFn('saveSection', { jar: host.jar, data: sectionData(propertyId, sectionId, { title: '' }) }),
        guideFn('saveSection', { jar: host.jar, data: sectionData(propertyId, sectionId, { body: 'x'.repeat(8001) }) }),
        guideFn('saveSection', { jar: host.jar, data: sectionData(propertyId, sectionId, { category: 'unicorns' }) }),
        guideFn('saveSection', {
          jar: host.jar,
          data: sectionData(propertyId, sectionId, { secretValue: 'SYNTHETIC-GUEST-SECRET' }),
        }),
        guideFn('saveSection', {
          jar: host.jar,
          data: sectionData(propertyId, crypto.randomUUID(), { title: 'Synthetic unknown section' }),
        }),
        guideFn('saveProperty', { jar: host.jar, data: { propertyId, displayName: '', sourceLocale: 'en' } }),
        guideFn('createProperty', { jar: host.jar, data: { displayName: 'x'.repeat(121), sourceLocale: 'en' } }),
        guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId: 'not-a-uuid' } }),
      ];
      for (const call of rejected) {
        expect(decode<{ error?: string }>(await call)?.result?.error).toBe('invalid_input');
      }

      const admin = localAdmin();
      try {
        const [properties] = await admin<{ n: number }[]>`
          select count(*)::int as n from app.properties where owner_id = ${host.userId}
        `;
        expect(properties?.n).toBe(1);
        const [saved] = await admin<{ n: number }[]>`
          select count(*)::int as n from app.setup_events
          where owner_id = ${host.userId} and event_type = 'section_saved'
        `;
        expect(saved?.n).toBe(0);
      } finally {
        await admin.end({ timeout: 0 });
      }

      const editor = decode<{ editor: { sections: { title: string; sourceRevision: number }[] } }>(
        await guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId } }),
      )?.result?.editor;
      expect(editor?.sections[0]?.title).toBe('');
      expect(editor?.sections[0]?.sourceRevision).toBe(1);
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('rolls publication back when the publish audit row cannot be written', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'audit-atomic');
    const marker = 'SYNTHETIC-FIX1-AUDIT-FAILURE';
    const admin = localAdmin();
    const logBefore = devServerLogBytes()?.length ?? 0;
    try {
      const propertyId = await createProperty(host);
      await admin.unsafe(`
        create or replace function app.fix1_reject_publish_audit() returns trigger language plpgsql as $$
        begin
          if new.actor_id = ${quoteLiteral(host.userId)}::uuid and new.action = 'publish' then
            raise exception ${quoteLiteral(marker)};
          end if;
          return new;
        end $$;
        drop trigger if exists fix1_reject_publish_audit on app.audit_events;
        create trigger fix1_reject_publish_audit before insert on app.audit_events
          for each row execute function app.fix1_reject_publish_audit();
      `);

      const reply = await guideFn('setGuidePublished', { jar: host.jar, data: { propertyId, published: true } });
      expect(decode<{ error?: string }>(reply)?.result?.error).toBe('unexpected');
      expect(reply.body).not.toContain(marker);

      const [state] = await admin<{ published: boolean; publish_audits: number }[]>`
        select published,
          (select count(*)::int from app.audit_events
            where actor_id = ${host.userId} and action = 'publish') as publish_audits
        from app.properties where id = ${propertyId}
      `;
      expect(state?.published).toBe(false);
      expect(state?.publish_audits).toBe(0);
      const [clicks] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.setup_events
        where owner_id = ${host.userId} and event_type = 'publish_clicked'
      `;
      expect(clicks?.n).toBe(0);

      const logSlice = await waitForLogSlice(logBefore, '"event":"server_error"');
      if (logSlice !== null) {
        expect(logSlice).toContain('"event":"server_error"');
        expect(logSlice).not.toContain(marker);
      }
    } finally {
      await admin.unsafe(
        'drop trigger if exists fix1_reject_publish_audit on app.audit_events; drop function if exists app.fix1_reject_publish_audit()',
      );
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('rejects schema-invalid input at the canonical write layer without writing', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'canonical');
    try {
      const propertyId = await createProperty(host);
      const sectionId = await createSection(host, propertyId, 'wifi');
      const invalidCalls = [
        () =>
          withOwnerContext(host.userId, (tx) =>
            insertProperty(tx, { displayName: '', sourceLocale: 'not a locale', enabledLocales: [] }),
          ),
        () =>
          withOwnerContext(host.userId, (tx) =>
            updateProperty(tx, { propertyId, displayName: '', sourceLocale: 'en', enabledLocales: [] }),
          ),
        () =>
          withOwnerContext(host.userId, (tx) =>
            insertSection(tx, { propertyId, category: 'unicorns' as SectionCategory }),
          ),
        () =>
          withOwnerContext(host.userId, (tx) =>
            updateSection(tx, {
              propertyId,
              sectionId,
              category: 'wifi',
              title: '',
              body: 'SYNTHETIC-CANONICAL-BODY',
              visibility: 'guest',
              secretValue: '',
              published: true,
            }),
          ),
        () =>
          withOwnerContext(host.userId, (tx) =>
            moveSection(tx, { propertyId, sectionId, direction: 'sideways' as 'up' }),
          ),
      ];
      for (const call of invalidCalls) {
        await expect(call()).rejects.toThrow('invalid_input');
      }

      const admin = localAdmin();
      try {
        const [invalid] = await admin<{ n: number }[]>`
          select count(*)::int as n from app.properties
          where owner_id = ${host.userId} and (display_name = '' or source_locale = 'not a locale')
        `;
        expect(invalid?.n).toBe(0);
        const [properties] = await admin<{ n: number }[]>`
          select count(*)::int as n from app.properties where owner_id = ${host.userId}
        `;
        expect(properties?.n).toBe(1);
        const [bodies] = await admin<{ n: number }[]>`
          select count(*)::int as n from app.guide_sections s
          join app.properties p on p.id = s.property_id
          where p.owner_id = ${host.userId} and s.body = 'SYNTHETIC-CANONICAL-BODY'
        `;
        expect(bodies?.n).toBe(0);
        const [section] = await admin<{ display_order: number; published: boolean }[]>`
          select s.display_order, s.published from app.guide_sections s
          join app.properties p on p.id = s.property_id
          where p.owner_id = ${host.userId}
        `;
        expect(section?.display_order).toBe(1);
        expect(section?.published).toBe(false);
      } finally {
        await admin.end({ timeout: 0 });
      }

      const editor = decode<{ editor: { property: { displayName: string } } }>(
        await guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId } }),
      )?.result?.editor;
      expect(editor?.property.displayName).toBe('Guide integration villa (synthetic)');
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('serializes concurrent section creation into distinct display orders', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'order-concurrent');
    try {
      const propertyId = await createProperty(host);
      const created = await Promise.all(
        Array.from({ length: 5 }, () =>
          withOwnerContext(host.userId, (tx) => insertSection(tx, { propertyId, category: 'parking' })),
        ),
      );
      expect(new Set(created).size).toBe(5);
      const editor = await withOwnerContext(host.userId, (tx) => readGuideEditor(tx, propertyId));
      expect(editor?.sections.map((section) => section.displayOrder)).toEqual([1, 2, 3, 4, 5]);

      const admin = localAdmin();
      try {
        const stored = await admin<{ display_order: number }[]>`
          select display_order from app.guide_sections
          where property_id = ${propertyId}
          order by display_order, created_at, id
        `;
        expect(stored.map((row) => row.display_order)).toEqual([1, 2, 3, 4, 5]);
      } finally {
        await admin.end({ timeout: 0 });
      }
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('repairs tied display orders so a move actually moves', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'order-tied');
    try {
      const propertyId = await createProperty(host);
      const first = await createSection(host, propertyId, 'wifi');
      const second = await createSection(host, propertyId, 'parking');
      const third = await createSection(host, propertyId, 'rules');

      const admin = localAdmin();
      try {
        await admin`
          update app.guide_sections set display_order = 2
          where property_id = ${propertyId} and id in (${second}, ${third})
        `;
        const [before] = await admin<{ ids: string[] }[]>`
          select array_agg(id order by display_order, created_at, id)::text[] as ids
          from app.guide_sections where property_id = ${propertyId}
        `;
        expect(before?.ids).toEqual([first, second, third]);

        const moved = await withOwnerContext(host.userId, (tx) =>
          moveSection(tx, { propertyId, sectionId: third, direction: 'up' }),
        );
        expect(moved).toBe(true);

        const [after] = await admin<{ ids: string[] }[]>`
          select array_agg(id order by display_order, created_at, id)::text[] as ids
          from app.guide_sections where property_id = ${propertyId}
        `;
        expect(after?.ids).toEqual([first, third, second]);
        const orders = await admin<{ display_order: number }[]>`
          select display_order from app.guide_sections
          where property_id = ${propertyId}
          order by display_order, created_at, id
        `;
        expect(orders.map((row) => row.display_order)).toEqual([1, 2, 3]);
      } finally {
        await admin.end({ timeout: 0 });
      }
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 60_000);

  it('keeps property credentials owner-only and out of copies, guest reads, and the guest DTO', async () => {
    const local = localStack as LocalStack;
    const owner = await verifiedHost(local, 'essentials-owner');
    const intruder = await verifiedHost(local, 'essentials-intruder');
    const admin = localAdmin();
    const password = `SYNTHETIC-WIFI-PASS-${Date.now()}`;
    const keybox = `KB${Date.now() % 100000}`;
    try {
      const propertyId = await createProperty(owner);
      const saved = await guideFn('saveProperty', {
        jar: owner.jar,
        data: {
          propertyId,
          displayName: 'Guide integration villa (synthetic)',
          sourceLocale: 'en',
          wifiName: 'Synthetic net',
          wifiPassword: password,
          keyboxCode: keybox,
          checkinTime: '15:00',
          checkoutTime: '10:30',
          address: 'Synthetic street 1',
          timezone: 'Europe/Ljubljana',
        },
      });
      expect(decode<{ ok?: boolean }>(saved)?.result).toEqual({ ok: true });
      const editor = await withOwnerContext(owner.userId, (tx) => readGuideEditor(tx, propertyId));
      expect(editor?.property).toMatchObject({
        wifiName: 'Synthetic net',
        wifiPassword: password,
        keyboxCode: keybox,
        checkinTime: '15:00',
        checkoutTime: '10:30',
      });

      const renamed = await guideFn('saveProperty', {
        jar: owner.jar,
        data: { propertyId, displayName: 'Renamed villa (synthetic)', sourceLocale: 'en', wifiName: ' Spaced net ' },
      });
      expect(decode<{ ok?: boolean }>(renamed)?.result).toEqual({ ok: true });
      const kept = await withOwnerContext(owner.userId, (tx) => readGuideEditor(tx, propertyId));
      expect(kept?.property).toMatchObject({
        wifiName: ' Spaced net ',
        wifiPassword: password,
        checkinTime: '15:00',
        address: 'Synthetic street 1',
        timezone: 'Europe/Ljubljana',
      });

      const foreign = await withOwnerContext(intruder.userId, (tx) =>
        tx`select 1 from app.property_credentials where property_id = ${propertyId}`.then((rows) => rows.length),
      );
      expect(foreign).toBe(0);
      const crossWrite = await guideFn('saveProperty', {
        jar: intruder.jar,
        data: { propertyId, displayName: 'Hijack', sourceLocale: 'en', wifiPassword: 'hijack' },
      });
      expect(decode<{ error?: string }>(crossWrite)?.result?.error).toBe('invalid_input');

      await admin`update app.properties set published = true where id = ${propertyId}`;
      const guestRows = await withLinkContext(`itess${Date.now()}`, async (tx) => {
        await tx`select set_config('app.link_property_id', ${propertyId}, true)`;
        return tx`select wifi_password from app.property_credentials`;
      });
      expect(guestRows).toHaveLength(0);
      const [privileges] = await admin<{ anon: boolean; authenticated: boolean }[]>`
        select has_table_privilege('anon', 'app.property_credentials', 'select') as anon,
          has_table_privilege('authenticated', 'app.property_credentials', 'select') as authenticated
      `;
      expect(privileges).toEqual({ anon: false, authenticated: false });

      const preview = await guideFn('getGuestPreview', { jar: owner.jar, data: { propertyId } });
      const previewResult = decode<{ guest: unknown; essentials: { keyboxCode: string | null } }>(preview)?.result;
      expect(previewResult?.essentials.keyboxCode).toBe(keybox);
      expect(JSON.stringify(previewResult?.guest)).not.toContain(password);

      const copied = decode<{ propertyId?: string }>(
        await guideFn('copyProperty', { jar: owner.jar, data: { sourcePropertyId: propertyId } }),
      )?.result;
      if (!copied?.propertyId) throw new Error('synthetic copy failed');
      const copy = await withOwnerContext(owner.userId, (tx) => readGuideEditor(tx, copied.propertyId as string));
      expect(copy?.property).toMatchObject({
        wifiName: 'Synthetic net',
        wifiPassword: null,
        keyboxCode: null,
        checkinTime: '15:00',
        checkoutTime: '10:30',
        address: 'Synthetic street 1',
      });

      await admin`update app.properties set timezone = 'Legacy/Synthetic' where id = ${propertyId}`;
      const base = { propertyId, displayName: 'Renamed villa (synthetic)', sourceLocale: 'en' };
      const resave = async (extra: Record<string, string>) =>
        decode<{ ok?: boolean; error?: string }>(
          await guideFn('saveProperty', { jar: owner.jar, data: { ...base, ...extra } }),
        )?.result;
      expect(await resave({ timezone: 'Legacy/Synthetic', address: '' })).toEqual({ ok: true });
      expect(await resave({ timezone: 'Mars/Olympus' })).toEqual({ error: 'invalid_input' });
      expect(await resave({})).toEqual({ ok: true });
      const legacy = await withOwnerContext(owner.userId, (tx) => readGuideEditor(tx, propertyId));
      expect(legacy?.property).toMatchObject({ timezone: 'Legacy/Synthetic', address: null });
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(owner.userId);
      await adminClient(local).deleteUser(intruder.userId);
    }
  }, 90_000);
});
