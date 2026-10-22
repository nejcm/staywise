import { createHash } from 'node:crypto';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type postgres from 'postgres';
import { z } from 'zod';
import { insertAudit } from '../../lib/audit.server';
import { withOwnerContext } from '../../lib/db.server';
import { appEnv } from '../../lib/env.server';
import { logEvent } from '../../lib/log.server';
import { readiness } from '../guide/readiness';
import {
  essentialsFields,
  guestLocaleSchema,
  guestThemes,
  propertyFields,
  sectionCategories,
  sectionTextInput,
  type GuestLocale,
  type SectionCategory,
  type SectionVisibility,
} from '../guide/guide-validation';
import {
  insertSection,
  insertSectionRevision,
  moveSection,
  updateProperty,
  updateSectionText,
} from '../guide/guide.server';
import { markMessageHandled } from '../messages/messages.server';
import {
  linkReservation,
  newShareLink,
  reservationBatchInput,
  revokeStayLink,
  upsertReservations,
} from '../share/share.server';
import { approveTranslation, rejectTranslation } from '../translation/translation.server';
import { agentWriteAllowed, cleanText, type AgentPrincipal } from './agent-auth.server';
import { addedContact, type AddedContact } from './agent-guard';
import type { AgentScope } from './agent-validation';

const PAGE_MAX = 50;
const importedTextMax = 200;
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

type Found<T> = { data: T; propertyIds: string[]; rowCount: number } | null;
type Outcome = 'ok' | 'denied' | 'error';

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  );
}

const toolError = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });

// A refusal the agent may read; anything else surfaces as a generic error.
export class AgentRefusal extends Error {}

// The scope each tool's runTool call checks; /mcp reads it to answer OAuth tokens with a step-up.
export const toolScopes = new Map<string, AgentScope>([
  ['list_properties', 'read'],
  ['get_property', 'read'],
  ['list_reservations', 'read'],
  ['list_inbox', 'read'],
  ['update_property', 'content:write'],
  ['upsert_section', 'content:write'],
  ['move_section', 'content:write'],
  ['review_translation', 'content:write'],
  ['upsert_reservations', 'reservations:write'],
  ['create_stay_link', 'reservations:write'],
  ['revoke_stay_link', 'reservations:write'],
  ['mark_inbox_handled', 'inbox:write'],
]);

// Single choke point (Q9, Q22): scope and property restriction, owner-scoped RLS, and one audit row per call.
export async function runTool<T extends Record<string, unknown>>(
  principal: AgentPrincipal,
  tool: string,
  scope: AgentScope,
  args: { propertyId?: string } & Record<string, unknown>,
  work: (tx: postgres.TransactionSql, propertyId: string | null) => Promise<Found<T>>,
): Promise<CallToolResult> {
  const started = performance.now();
  const audit = (tx: postgres.TransactionSql, outcome: Outcome, propertyIds: string[], rowCount: number) => tx`
    insert into app.audit_events (actor_id, action, grant_id, tool, property_ids, row_count, outcome, latency_ms, args_digest)
    values (${principal.ownerId}, 'agent_tool_call', ${principal.grantId}, ${tool}, ${propertyIds}::uuid[], ${rowCount},
      ${outcome}, ${Math.round(performance.now() - started)}, ${createHash('sha256').update(canonicalJson(args)).digest()})
  `;
  const requested = args.propertyId;
  const allowed =
    principal.scopes.includes(scope) && (!principal.propertyId || !requested || requested === principal.propertyId);
  try {
    if (!allowed) {
      await withOwnerContext(principal.ownerId, (tx) => audit(tx, 'denied', requested ? [requested] : [], 0));
      return toolError('This token does not allow that. Ask the host to check its scopes and property.');
    }
    if (scope !== 'read' && !(await agentWriteAllowed(principal))) {
      await withOwnerContext(principal.ownerId, (tx) => audit(tx, 'denied', requested ? [requested] : [], 0));
      return toolError('Too many changes in a short time. Wait a minute and try again.');
    }
    return await withOwnerContext(principal.ownerId, async (tx) => {
      const found = await work(tx, requested ?? principal.propertyId);
      await audit(tx, 'ok', found?.propertyIds ?? [], found?.rowCount ?? 0);
      if (!found) return toolError('Not found.');
      return { content: [{ type: 'text', text: JSON.stringify(found.data) }], structuredContent: found.data };
    });
  } catch (error) {
    const refused = error instanceof AgentRefusal;
    await withOwnerContext(principal.ownerId, (tx) =>
      audit(tx, refused ? 'denied' : 'error', requested ? [requested] : [], 0),
    ).catch(() => logEvent('audit_write_failed', { appEnv, status: 500 }));
    return toolError(refused ? error.message : 'Something went wrong. Try again.');
  }
}

const pageInput = {
  propertyId: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(PAGE_MAX).optional(),
};

function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

function decodeCursor(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const parts: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parts) && parts.length === 2) {
      const [first, second]: unknown[] = parts;
      if (typeof first === 'string' && typeof second === 'string') return [first, second];
    }
  } catch {
    // An unreadable cursor restarts from the first page.
  }
  return null;
}

function page<R>(rows: R[], limit: number, cursorOf: (row: R) => string[]) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}

const propertySummary = z.strictObject({
  id: z.string(),
  name: z.string(),
  published: z.boolean(),
  timezone: z.string(),
  sourceLocale: z.string(),
  enabledLocales: z.array(z.string()),
});
const listPropertiesOutput = z.strictObject({ properties: z.array(propertySummary) });

const getPropertyOutput = z.strictObject({
  property: propertySummary.extend({
    checkinTime: z.string().nullable(),
    checkoutTime: z.string().nullable(),
    address: z.string().nullable(),
    contactPhone: z.string().nullable(),
    answerFrom: z.string().nullable(),
    answerTo: z.string().nullable(),
    wifiNameSet: z.boolean(),
    wifiPasswordSet: z.boolean(),
    keyboxCodeSet: z.boolean(),
    guestLinkIssued: z.boolean(),
  }),
  sections: z.array(
    z.strictObject({
      id: z.string(),
      category: z.string(),
      title: z.string(),
      body: z.string(),
      visibility: z.string(),
      published: z.boolean(),
      displayOrder: z.number(),
      secretSet: z.boolean(),
      translations: z.array(
        z.strictObject({
          id: z.string(),
          locale: z.string(),
          state: z.enum(['draft', 'approved']),
          current: z.boolean(),
          title: z.string(),
          body: z.string(),
        }),
      ),
    }),
  ),
  readiness: z.array(z.strictObject({ key: z.string(), label: z.string(), done: z.boolean(), optional: z.boolean() })),
});

const listReservationsOutput = z.strictObject({
  reservations: z.array(
    z.strictObject({
      id: z.string(),
      propertyId: z.string(),
      source: z.string(),
      externalId: z.string(),
      stayStart: z.string(),
      stayEnd: z.string(),
      stayLinkIssued: z.boolean(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

const listInboxOutput = z.strictObject({
  messages: z.array(
    z.strictObject({
      id: z.string(),
      propertyId: z.string(),
      kind: z.string(),
      receivedAt: z.string(),
      handled: z.boolean(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

type PropertyRow = {
  id: string;
  display_name: string;
  published: boolean;
  timezone: string;
  source_locale: string;
  enabled_locales: string[];
};

const summarize = (row: PropertyRow): z.infer<typeof propertySummary> => ({
  id: row.id,
  name: row.display_name,
  published: row.published,
  timezone: row.timezone,
  sourceLocale: row.source_locale,
  enabledLocales: row.enabled_locales,
});

async function listProperties(
  tx: postgres.TransactionSql,
  propertyId: string | null,
): Promise<Found<z.infer<typeof listPropertiesOutput>>> {
  const rows = await tx<PropertyRow[]>`
    select id, display_name, published, timezone, source_locale, enabled_locales
    from app.properties
    where ${propertyId}::uuid is null or id = ${propertyId}
    order by display_name, id
  `;
  return { data: { properties: rows.map(summarize) }, propertyIds: rows.map((row) => row.id), rowCount: rows.length };
}

// Credentials leave only as booleans (Q13); alert_email and secret_value are never selected as values.
async function getProperty(
  tx: postgres.TransactionSql,
  propertyId: string,
): Promise<Found<z.infer<typeof getPropertyOutput>>> {
  const [row] = await tx<
    (PropertyRow & {
      checkin_time: string | null;
      checkout_time: string | null;
      address: string | null;
      contact_phone: string | null;
      answer_from: string | null;
      answer_to: string | null;
      wifi_name_set: boolean;
      wifi_password_set: boolean;
      keybox_code_set: boolean;
      guest_link_issued: boolean;
    })[]
  >`
    select p.id, p.display_name, p.published, p.timezone, p.source_locale, p.enabled_locales, p.address, p.contact_phone,
      to_char(p.checkin_time, 'HH24:MI') as checkin_time, to_char(p.checkout_time, 'HH24:MI') as checkout_time,
      to_char(p.answer_from, 'HH24:MI') as answer_from, to_char(p.answer_to, 'HH24:MI') as answer_to,
      c.wifi_name is not null as wifi_name_set, c.wifi_password is not null as wifi_password_set,
      c.keybox_code is not null as keybox_code_set,
      exists (select 1 from app.share_links k where k.property_id = p.id and k.enabled and k.kind = 'property') as guest_link_issued
    from app.properties p
    left join app.property_credentials c on c.property_id = p.id
    where p.id = ${propertyId}
  `;
  if (!row) return null;
  const sections = await tx<
    {
      id: string;
      category: SectionCategory;
      title: string;
      body: string;
      visibility: SectionVisibility;
      published: boolean;
      display_order: number;
      secret_set: boolean;
    }[]
  >`
    select id, category, title, body, visibility, published, display_order, secret_value is not null as secret_set
    from app.guide_sections
    where property_id = ${propertyId}
    order by display_order, created_at, id
  `;
  const translations = await tx<
    {
      id: string;
      section_id: string;
      locale: string;
      state: 'draft' | 'approved';
      current: boolean;
      title: string;
      body: string;
    }[]
  >`
    select t.id, t.section_id, t.locale, t.state, t.title, t.body,
      t.source_revision = s.source_revision and t.source_locale = p.source_locale as current
    from app.guide_translations t
    join app.guide_sections s on s.id = t.section_id
    join app.properties p on p.id = s.property_id
    where s.property_id = ${propertyId}
    order by t.locale, t.created_at
  `;
  const items = readiness(
    {
      hero: null,
      property: {
        checkinTime: row.checkin_time,
        checkoutTime: row.checkout_time,
        address: row.address,
        contactPhone: row.contact_phone,
        wifiPassword: row.wifi_password_set,
        published: row.published,
      },
      sections,
    },
    row.guest_link_issued,
  );
  return {
    data: {
      property: {
        ...summarize(row),
        checkinTime: row.checkin_time,
        checkoutTime: row.checkout_time,
        address: row.address,
        contactPhone: row.contact_phone,
        answerFrom: row.answer_from,
        answerTo: row.answer_to,
        wifiNameSet: row.wifi_name_set,
        wifiPasswordSet: row.wifi_password_set,
        keyboxCodeSet: row.keybox_code_set,
        guestLinkIssued: row.guest_link_issued,
      },
      sections: sections.map((section) => ({
        id: section.id,
        category: section.category,
        title: section.title,
        body: section.body,
        visibility: section.visibility,
        published: section.published,
        displayOrder: section.display_order,
        secretSet: section.secret_set,
        translations: translations
          .filter((translation) => translation.section_id === section.id)
          .map((translation) => ({
            id: translation.id,
            locale: translation.locale,
            state: translation.state,
            current: translation.current,
            title: translation.title,
            body: translation.body,
          })),
      })),
      readiness: items.map((item) => ({
        key: item.key,
        label: item.label,
        done: item.done,
        optional: item.optional ?? false,
      })),
    },
    propertyIds: [row.id],
    rowCount: 1 + sections.length,
  };
}

// Reservation and inbox rows carry no guest identity, bodies or reply addresses (Q3, Q6).
async function listReservations(
  tx: postgres.TransactionSql,
  propertyId: string | null,
  cursor: string | undefined,
  limit = PAGE_MAX,
): Promise<Found<z.infer<typeof listReservationsOutput>>> {
  const after = decodeCursor(cursor);
  const rows = await tx<
    {
      id: string;
      property_id: string;
      source: string;
      external_id: string;
      stay_start: string;
      stay_end: string;
      stay_link_issued: boolean;
    }[]
  >`
    select r.id, r.property_id, r.source, r.external_id, r.stay_start::text, r.stay_end::text,
      exists (select 1 from app.share_links k where k.reservation_id = r.id and k.enabled) as stay_link_issued
    from app.reservations r
    where (${propertyId}::uuid is null or r.property_id = ${propertyId})
      and (${after?.[0] ?? null}::date is null or (r.stay_start, r.id) > (${after?.[0] ?? null}::date, ${after?.[1] ?? null}::uuid))
    order by r.stay_start, r.id
    limit ${limit + 1}
  `;
  const { items, nextCursor } = page(rows, limit, (row) => [row.stay_start, row.id]);
  return {
    data: {
      reservations: items.map((row) => ({
        id: row.id,
        propertyId: row.property_id,
        source: cleanText(row.source, importedTextMax),
        externalId: cleanText(row.external_id, importedTextMax),
        stayStart: row.stay_start,
        stayEnd: row.stay_end,
        stayLinkIssued: row.stay_link_issued,
      })),
      nextCursor,
    },
    propertyIds: [...new Set(items.map((row) => row.property_id))],
    rowCount: items.length,
  };
}

async function listInbox(
  tx: postgres.TransactionSql,
  propertyId: string | null,
  cursor: string | undefined,
  limit = PAGE_MAX,
): Promise<Found<z.infer<typeof listInboxOutput>>> {
  const before = decodeCursor(cursor);
  const rows = await tx<
    { id: string; property_id: string; kind: string; created_at: Date; created_at_text: string; state: string }[]
  >`
    select id, property_id, kind, created_at, created_at::text as created_at_text, state
    from app.guest_messages
    where (${propertyId}::uuid is null or property_id = ${propertyId})
      and (${before?.[0] ?? null}::timestamptz is null
        or (created_at, id) < (${before?.[0] ?? null}::timestamptz, ${before?.[1] ?? null}::uuid))
    order by created_at desc, id desc
    limit ${limit + 1}
  `;
  const { items, nextCursor } = page(rows, limit, (row) => [row.created_at_text, row.id]);
  return {
    data: {
      messages: items.map((row) => ({
        id: row.id,
        propertyId: row.property_id,
        kind: cleanText(row.kind, 20),
        receivedAt: row.created_at.toISOString(),
        handled: row.state === 'handled',
      })),
      nextCursor,
    },
    propertyIds: [...new Set(items.map((row) => row.property_id))],
    rowCount: items.length,
  };
}

const addedLabels: Record<AddedContact, string> = {
  link: 'link',
  email: 'email address',
  phone: 'phone number',
  payment: 'bank account number',
};

function refuseAddedContact(before: string, after: string) {
  const added = addedContact(before, after);
  if (added) {
    throw new AgentRefusal(`Agents cannot add a new ${addedLabels[added]}. Ask the host to add it in Staywise.`);
  }
}

const joined = (text: { title: string; body: string }) => `${text.title}\n${text.body}`;

const updatePropertyInput = z.strictObject({
  propertyId: z.uuid(),
  displayName: propertyFields.shape.displayName.optional(),
  sourceLocale: guestLocaleSchema.optional(),
  enabledLocales: z.array(guestLocaleSchema).max(3).optional(),
  timezone: z.string().max(64).optional(),
  theme: z.enum(guestThemes).optional(),
  checkinTime: essentialsFields.shape.checkinTime,
  checkoutTime: essentialsFields.shape.checkoutTime,
  address: essentialsFields.shape.address,
  answerFrom: essentialsFields.shape.answerFrom,
  answerTo: essentialsFields.shape.answerTo,
});
const upsertSectionInput = z.strictObject({
  ...sectionTextInput.shape,
  sectionId: sectionTextInput.shape.sectionId.optional(),
  category: z.enum(sectionCategories).optional(),
});
const moveSectionToolInput = z.strictObject({
  propertyId: z.uuid(),
  sectionId: z.uuid(),
  direction: z.enum(['up', 'down']),
});
const reviewTranslationInput = z.strictObject({
  propertyId: z.uuid(),
  translationId: z.uuid(),
  decision: z.enum(['approve', 'reject']),
  title: z.string().trim().min(1).max(400).optional(),
  body: z.string().trim().min(1).max(16000).optional(),
});
const stayInput = z.strictObject({ propertyId: z.uuid(), reservationId: z.uuid() });
const messageInput = z.strictObject({ propertyId: z.uuid(), messageId: z.uuid() });

const changedOutput = z.strictObject({ id: z.string(), changed: z.boolean() });
const upsertSectionOutput = z.strictObject({ sectionId: z.string(), created: z.boolean(), sourceRevision: z.number() });
const upsertReservationsOutput = z.strictObject({
  created: z.number(),
  updated: z.number(),
  reservations: z.array(
    z.strictObject({ id: z.string(), source: z.string(), externalId: z.string(), created: z.boolean() }),
  ),
});
const stayLinkOutput = z.strictObject({ reservationId: z.string(), expiresAt: z.string() });

type Changed = Found<z.infer<typeof changedOutput>>;
const changed = (id: string, propertyId: string, didChange: boolean): Changed => ({
  data: { id, changed: didChange },
  propertyIds: [propertyId],
  rowCount: didChange ? 1 : 0,
});

// Credentials, the alert email and the guest-facing phone are not in the input schema at all (Q13, Q19).
async function updatePropertyTool(
  tx: postgres.TransactionSql,
  args: z.infer<typeof updatePropertyInput>,
): Promise<Changed> {
  const [current] = await tx<
    {
      display_name: string;
      source_locale: GuestLocale;
      enabled_locales: GuestLocale[];
      address: string | null;
    }[]
  >`
    select display_name, source_locale, enabled_locales, address
    from app.properties where id = ${args.propertyId}
  `;
  if (!current) return null;
  if (args.displayName !== undefined) refuseAddedContact(current.display_name, args.displayName);
  if (args.address !== undefined) refuseAddedContact(current.address ?? '', args.address);
  const saved = await updateProperty(tx, {
    ...args,
    displayName: args.displayName ?? current.display_name,
    sourceLocale: args.sourceLocale ?? current.source_locale,
    enabledLocales: args.enabledLocales ?? current.enabled_locales,
  });
  if (!saved) throw new AgentRefusal('Check the time zone, and set both answering times or neither.');
  return changed(args.propertyId, args.propertyId, true);
}

async function upsertSectionTool(
  tx: postgres.TransactionSql,
  grantId: string,
  args: z.infer<typeof upsertSectionInput>,
): Promise<Found<z.infer<typeof upsertSectionOutput>>> {
  const { propertyId, title, body } = args;
  if (args.sectionId && args.category) throw new AgentRefusal('A category applies only when adding a section.');
  if (!args.sectionId && !args.category) throw new AgentRefusal('Pass a category to add a section.');
  const sectionId = args.sectionId ?? (await insertSection(tx, { propertyId, category: args.category! }));
  if (!sectionId) return null;
  const updated = await updateSectionText(tx, { propertyId, sectionId, title, body });
  if (!updated) return null;
  const before = args.sectionId ? updated.before : null;
  refuseAddedContact(before ? joined(before) : '', joined({ title, body }));
  if (!before || joined(before) !== joined({ title, body })) {
    await insertSectionRevision(tx, { sectionId, grantId, before, after: { title, body } });
  }
  return {
    data: { sectionId, created: !before, sourceRevision: updated.sourceRevision },
    propertyIds: [propertyId],
    rowCount: 1,
  };
}

async function reviewTranslationTool(
  tx: postgres.TransactionSql,
  principal: AgentPrincipal,
  args: z.infer<typeof reviewTranslationInput>,
): Promise<Changed> {
  const [draft] = await tx<{ title: string; body: string; source_revision: number }[]>`
    select t.title, t.body, t.source_revision
    from app.guide_translations t join app.guide_sections s on s.id = t.section_id
    where t.id = ${args.translationId} and s.property_id = ${args.propertyId} and t.state = 'draft'
    for update of t
  `;
  if (!draft) return null;
  const { propertyId, translationId } = args;
  if (args.decision === 'reject') {
    await rejectTranslation(tx, { propertyId, translationId });
    await insertAudit(tx, principal.ownerId, 'translation_rejected', principal.grantId);
    return changed(translationId, propertyId, true);
  }
  const title = args.title ?? draft.title;
  const body = args.body ?? draft.body;
  refuseAddedContact(joined(draft), joined({ title, body }));
  const approved = await approveTranslation(tx, {
    propertyId,
    translationId,
    sourceRevision: draft.source_revision,
    title,
    body,
  });
  if (!approved) throw new AgentRefusal('This draft is out of date. Ask the host to generate translations again.');
  await insertAudit(tx, principal.ownerId, 'translation_approved', principal.grantId);
  return changed(translationId, propertyId, true);
}

async function upsertReservationsTool(
  tx: postgres.TransactionSql,
  args: z.infer<typeof reservationBatchInput>,
): Promise<Found<z.infer<typeof upsertReservationsOutput>>> {
  const rows = await upsertReservations(tx, args);
  if (!rows) return null;
  const created = rows.filter((row) => row.created).length;
  return {
    data: {
      created,
      updated: rows.length - created,
      reservations: rows.map((row) => ({
        id: row.id,
        source: cleanText(row.source, importedTextMax),
        externalId: cleanText(row.externalId, importedTextMax),
        created: row.created,
      })),
    },
    propertyIds: [args.propertyId],
    rowCount: rows.length,
  };
}

// The secret is generated and dropped here: the host copies a fresh link from Staywise (Q4).
async function createStayLinkTool(
  tx: postgres.TransactionSql,
  principal: AgentPrincipal,
  args: z.infer<typeof stayInput>,
): Promise<Found<z.infer<typeof stayLinkOutput>>> {
  const [reservation] = await tx`
    select id from app.reservations where id = ${args.reservationId} and property_id = ${args.propertyId}
  `;
  if (!reservation) return null;
  const { id, hmac } = newShareLink();
  const expiresAt = await linkReservation(tx, { ...args, id, hmac });
  if (!expiresAt) throw new AgentRefusal('This stay already has a link, or it has ended.');
  await insertAudit(tx, principal.ownerId, 'stay_link_created', principal.grantId);
  return {
    data: { reservationId: args.reservationId, expiresAt: expiresAt.toISOString() },
    propertyIds: [args.propertyId],
    rowCount: 1,
  };
}

async function revokeStayLinkTool(
  tx: postgres.TransactionSql,
  principal: AgentPrincipal,
  args: z.infer<typeof stayInput>,
): Promise<Changed> {
  if (!(await revokeStayLink(tx, args))) return null;
  await insertAudit(tx, principal.ownerId, 'stay_link_revoked', principal.grantId);
  return changed(args.reservationId, args.propertyId, true);
}

async function markInboxHandledTool(
  tx: postgres.TransactionSql,
  principal: AgentPrincipal,
  args: z.infer<typeof messageInput>,
): Promise<Changed> {
  if (await markMessageHandled(tx, args)) {
    await insertAudit(tx, principal.ownerId, 'message_handled', principal.grantId);
    return changed(args.messageId, args.propertyId, true);
  }
  const [message] = await tx`
    select id from app.guest_messages where id = ${args.messageId} and property_id = ${args.propertyId}
  `;
  return message ? changed(args.messageId, args.propertyId, false) : null;
}

const contentWrite = {
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  _meta: { 'anthropic/requiresUserInteraction': true },
} as const;

// tools/list shows only what the token's scopes allow (Q25); runTool re-checks on every call.
export function agentServer(principal: AgentPrincipal): McpServer {
  const server = new McpServer({ name: 'staywise', version: '1.0.0' }, { capabilities: { tools: {} } });
  const { grantId, scopes } = principal;
  if (scopes.includes('read')) registerReadTools(server, principal);
  if (scopes.includes('content:write')) {
    server.registerTool(
      'update_property',
      {
        title: 'Update property',
        description:
          'Change property essentials. Omitted fields stay as they are; an empty string clears a field. Wi-Fi, key-box codes, the contact phone and the alert email can only be changed in Staywise.',
        inputSchema: updatePropertyInput,
        outputSchema: changedOutput,
        ...contentWrite,
      },
      (args) => runTool(principal, 'update_property', 'content:write', args, (tx) => updatePropertyTool(tx, args)),
    );
    server.registerTool(
      'upsert_section',
      {
        title: 'Add or edit a guide section',
        description:
          'Pass sectionId to edit a section title and body (live at once, if published), or a category to add a draft section the host publishes. Each change is shown to the host with a one-click revert. New links, email addresses, phone numbers and bank account numbers are refused.',
        inputSchema: upsertSectionInput,
        outputSchema: upsertSectionOutput,
        ...contentWrite,
      },
      (args) =>
        runTool(principal, 'upsert_section', 'content:write', args, (tx) => upsertSectionTool(tx, grantId, args)),
    );
    server.registerTool(
      'move_section',
      {
        title: 'Move a guide section',
        description: 'Move a section one place up or down in the guide.',
        inputSchema: moveSectionToolInput,
        outputSchema: changedOutput,
        ...contentWrite,
      },
      (args) =>
        runTool(principal, 'move_section', 'content:write', args, async (tx) =>
          (await moveSection(tx, args)) ? changed(args.sectionId, args.propertyId, true) : null,
        ),
    );
    server.registerTool(
      'review_translation',
      {
        title: 'Review a translation draft',
        description:
          'Approve a current draft (optionally with corrected title and body) so guests see it, or reject it. Approved translations can only be withdrawn in Staywise.',
        inputSchema: reviewTranslationInput,
        outputSchema: changedOutput,
        ...contentWrite,
      },
      (args) =>
        runTool(principal, 'review_translation', 'content:write', args, (tx) =>
          reviewTranslationTool(tx, principal, args),
        ),
    );
  }
  if (scopes.includes('reservations:write')) {
    server.registerTool(
      'upsert_reservations',
      {
        title: 'Import reservations',
        description:
          'Create or update up to 100 reservations for one property, matched on source and externalId, so re-importing the same calendar never duplicates. No guest names or party sizes.',
        inputSchema: z.strictObject(reservationBatchInput.shape),
        outputSchema: upsertReservationsOutput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      (args) =>
        runTool(principal, 'upsert_reservations', 'reservations:write', args, (tx) => upsertReservationsTool(tx, args)),
    );
    server.registerTool(
      'create_stay_link',
      {
        title: 'Create a stay link',
        description:
          'Turn on a guest link for one reservation until noon after check-out. The link itself is never shown to agents: the host copies it in Staywise under Share, Stays, New link.',
        inputSchema: stayInput,
        outputSchema: stayLinkOutput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      (args) =>
        runTool(principal, 'create_stay_link', 'reservations:write', args, (tx) =>
          createStayLinkTool(tx, principal, args),
        ),
    );
    server.registerTool(
      'revoke_stay_link',
      {
        title: 'Revoke a stay link',
        description: "Turn off a reservation's guest link. Guests of that stay lose access at once.",
        inputSchema: stayInput,
        outputSchema: changedOutput,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      },
      (args) =>
        runTool(principal, 'revoke_stay_link', 'reservations:write', args, (tx) =>
          revokeStayLinkTool(tx, principal, args),
        ),
    );
  }
  if (scopes.includes('inbox:write')) {
    server.registerTool(
      'mark_inbox_handled',
      {
        title: 'Mark a guest message handled',
        description: 'Mark one inbox message as handled. Message text stays in the Staywise inbox.',
        inputSchema: messageInput,
        outputSchema: changedOutput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      (args) =>
        runTool(principal, 'mark_inbox_handled', 'inbox:write', args, (tx) =>
          markInboxHandledTool(tx, principal, args),
        ),
    );
  }
  return server;
}

function registerReadTools(server: McpServer, principal: AgentPrincipal) {
  server.registerTool(
    'list_properties',
    {
      title: 'List properties',
      description: "The host's properties, or the one property this token is limited to.",
      inputSchema: z.strictObject({}),
      outputSchema: listPropertiesOutput,
      annotations: readOnly,
    },
    (args) => runTool(principal, 'list_properties', 'read', args, listProperties),
  );
  server.registerTool(
    'get_property',
    {
      title: 'Get property',
      description:
        'Essentials, guide sections and guest-readiness for one property. Credentials appear only as set or not set.',
      inputSchema: z.strictObject({ propertyId: z.uuid() }),
      outputSchema: getPropertyOutput,
      annotations: readOnly,
    },
    (args) => runTool(principal, 'get_property', 'read', args, (tx) => getProperty(tx, args.propertyId)),
  );
  server.registerTool(
    'list_reservations',
    {
      title: 'List reservations',
      description: `Reservations by stay start, up to ${PAGE_MAX} per page; pass nextCursor back as cursor for the next page.`,
      inputSchema: z.strictObject(pageInput),
      outputSchema: listReservationsOutput,
      annotations: readOnly,
    },
    (args) =>
      runTool(principal, 'list_reservations', 'read', args, (tx, propertyId) =>
        listReservations(tx, propertyId, args.cursor, args.limit),
      ),
  );
  server.registerTool(
    'list_inbox',
    {
      title: 'List inbox',
      description: `Guest message metadata, newest first, up to ${PAGE_MAX} per page. Message text and reply addresses stay in the Staywise inbox.`,
      inputSchema: z.strictObject(pageInput),
      outputSchema: listInboxOutput,
      annotations: readOnly,
    },
    (args) =>
      runTool(principal, 'list_inbox', 'read', args, (tx, propertyId) =>
        listInbox(tx, propertyId, args.cursor, args.limit),
      ),
  );
}
