import { createHash } from 'node:crypto';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type postgres from 'postgres';
import { z } from 'zod';
import { withOwnerContext } from '../../lib/db.server';
import { appEnv } from '../../lib/env.server';
import { logEvent } from '../../lib/log.server';
import { readiness } from '../guide/readiness';
import type { SectionCategory, SectionVisibility } from '../guide/guide-validation';
import { cleanText, type AgentPrincipal } from './agent-auth.server';
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
    return await withOwnerContext(principal.ownerId, async (tx) => {
      const found = await work(tx, requested ?? principal.propertyId);
      await audit(tx, 'ok', found?.propertyIds ?? [], found?.rowCount ?? 0);
      if (!found) return toolError('Not found.');
      return { content: [{ type: 'text', text: JSON.stringify(found.data) }], structuredContent: found.data };
    });
  } catch {
    await withOwnerContext(principal.ownerId, (tx) => audit(tx, 'error', [], 0)).catch(() =>
      logEvent('audit_write_failed', { appEnv, status: 500 }),
    );
    return toolError('Something went wrong. Try again.');
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

// tools/list shows only what the token's scopes allow (Q25); runTool re-checks on every call.
export function agentServer(principal: AgentPrincipal): McpServer {
  const server = new McpServer({ name: 'staywise', version: '1.0.0' }, { capabilities: { tools: {} } });
  if (!principal.scopes.includes('read')) return server;
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
  return server;
}
