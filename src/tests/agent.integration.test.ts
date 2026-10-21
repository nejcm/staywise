// Agent access (MCP) against the real local stack and dev server: token lifecycle through the settings
// server functions, output allowlists, and cross-property (BOLA) checks per tool. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { agentLimits, agentRequestAllowed, agentWriteAllowed } from '../features/agent/agent-auth.server';
import { sql } from '../lib/db.server';
import {
  APP,
  GUIDE_FNS,
  HOST_FNS,
  adminClient,
  decode,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  fnCall,
  localAdmin,
  verifiedHost,
  type LocalStack,
  type VerifiedHost,
} from './integration-helpers';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp ? describe : describe.skip;

const AGENT_FNS = '/src/features/agent/agent-fns.ts?tss-serverfn-split';
const SHARE_FNS = '/src/features/share/share-fns.ts?tss-serverfn-split';
const allScopes = ['read', 'content:write', 'reservations:write', 'inbox:write'];
const agentFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(AGENT_FNS, name, options);

const secrets = {
  wifiName: 'SyntheticNet-Q7',
  wifiPassword: 'synthetic-wifi-pass-Q7x',
  keybox: 'KB-9931',
  sectionSecret: 'synthetic-section-secret-55',
  alertEmail: 'alert-synthetic-agent@example.test',
  guestBody: 'Synthetic guest body that agents must never read',
  guestReply: 'guest-reply-synthetic@example.test',
  guestName: 'SyntheticGuestName',
};

const rlo = String.fromCodePoint(0x202e);

afterAll(async () => {
  await sql.end({ timeout: 0 });
});

async function seedProperty(ownerId: string, name: string): Promise<string> {
  const admin = localAdmin();
  const id = randomUUID();
  try {
    await admin`insert into app.properties (id, owner_id, display_name, alert_email) values (${id}, ${ownerId}, ${name}, ${secrets.alertEmail})`;
    await admin`insert into app.property_credentials (property_id, wifi_name, wifi_password, keybox_code)
      values (${id}, ${secrets.wifiName}, ${secrets.wifiPassword}, ${secrets.keybox})`;
    await admin`insert into app.guide_sections (property_id, category, title, body, visibility, secret_value)
      values (${id}, 'arrival', 'Key box', 'Host note', 'host', ${secrets.sectionSecret})`;
    await admin`insert into app.guest_messages (property_id, kind, body, follow_up_email)
      values (${id}, 'question', ${secrets.guestBody}, ${secrets.guestReply})`;
    await admin`insert into app.reservations (property_id, source, external_id, stay_start, stay_end, guest_first_name)
      values (${id}, 'airbnb', ${`HM${rlo}exe.txt\u0007-${id.slice(0, 8)}`}, '2026-11-01', '2026-11-05', ${secrets.guestName})`;
  } finally {
    await admin.end({ timeout: 0 });
  }
  return id;
}

type Rpc = {
  status: number;
  result?: Record<string, unknown> & { isError?: boolean; structuredContent?: unknown; content?: { text: string }[] };
  error?: { message: string };
};

async function mcp(
  token: string,
  method: string,
  params?: unknown,
  headers: Record<string, string> = {},
): Promise<Rpc> {
  const response = await fetch(`${APP}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await response.text();
  const json = text.startsWith('{') ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? '{}');
  return { status: response.status, ...(JSON.parse(json) as Pick<Rpc, 'result' | 'error'>) };
}

const call = (token: string, name: string, args: Record<string, unknown> = {}) =>
  mcp(token, 'tools/call', { name, arguments: args });

async function createToken(host: VerifiedHost, data: Record<string, unknown>): Promise<string> {
  const created = decode<{ token: string }>(
    await agentFn('createAgentToken', {
      jar: host.jar,
      data: { scopes: ['read'], propertyId: null, days: 30, ...data },
    }),
  )?.result;
  if (!created?.token) throw new Error('synthetic token creation failed');
  return created.token;
}

describeLocal('agent access against the local stack', () => {
  it('serves read tools with allowlisted output and holds the property boundary per tool', async () => {
    const local = localStack as LocalStack;
    const hostA = await verifiedHost(local, 'agent-a');
    const hostB = await verifiedHost(local, 'agent-b');
    try {
      const [a1, a2, b1] = [
        await seedProperty(hostA.userId, 'Agent A one (synthetic)'),
        await seedProperty(hostA.userId, 'Agent A two (synthetic)'),
        await seedProperty(hostB.userId, 'Agent B (synthetic)'),
      ];
      const tokenA = await createToken(hostA, { name: 'All of A' });
      const tokenA1 = await createToken(hostA, { name: 'Only A one', propertyId: a1 });
      const tokenB = await createToken(hostB, { name: 'All of B' });

      const outputs = [
        await call(tokenA, 'list_properties'),
        await call(tokenA, 'get_property', { propertyId: a1 }),
        await call(tokenA, 'list_reservations'),
        await call(tokenA, 'list_inbox'),
      ];
      for (const output of outputs) {
        expect(output.status).toBe(200);
        expect(output.result?.isError).toBeUndefined();
        const text = JSON.stringify(output);
        for (const secret of Object.values(secrets)) expect(text).not.toContain(secret);
        expect(text).not.toContain(rlo);
        expect(text).not.toContain('\\u0007');
      }
      const property = outputs[1]!.result?.structuredContent as { property: Record<string, unknown> };
      expect(property.property).toMatchObject({ wifiNameSet: true, wifiPasswordSet: true, keyboxCodeSet: true });

      const ids = (output: Rpc, key: string) => {
        const rows = (output.result?.structuredContent ?? {}) as Record<string, { id?: string; propertyId?: string }[]>;
        return (rows[key] ?? []).map((row) => row.propertyId ?? row.id);
      };
      expect(ids(outputs[0]!, 'properties').sort()).toEqual([a1, a2].sort());

      // Another host's property is indistinguishable from a missing one, for every tool.
      expect((await call(tokenB, 'get_property', { propertyId: a1 })).result).toMatchObject({ isError: true });
      expect(ids(await call(tokenB, 'list_properties'), 'properties')).toEqual([b1]);
      expect(ids(await call(tokenB, 'list_reservations', { propertyId: a1 }), 'reservations')).toEqual([]);
      expect(ids(await call(tokenB, 'list_inbox', { propertyId: a1 }), 'messages')).toEqual([]);

      // A property-restricted token sees only its property and is denied the owner's other one.
      expect(ids(await call(tokenA1, 'list_properties'), 'properties')).toEqual([a1]);
      expect(ids(await call(tokenA1, 'list_reservations'), 'reservations')).toEqual([a1]);
      expect(ids(await call(tokenA1, 'list_inbox'), 'messages')).toEqual([a1]);
      for (const [name, args] of [
        ['get_property', { propertyId: a2 }],
        ['list_reservations', { propertyId: a2 }],
        ['list_inbox', { propertyId: a2 }],
      ] as const) {
        expect((await call(tokenA1, name, args)).result).toMatchObject({ isError: true });
      }

      const admin = localAdmin();
      try {
        const audit = await admin<{ outcome: string; count: number }[]>`
          select outcome, count(*)::int as count from app.audit_events
          where actor_id = ${hostA.userId} and action = 'agent_tool_call' group by outcome order by outcome
        `;
        expect(audit).toEqual([
          { outcome: 'denied', count: 3 },
          { outcome: 'ok', count: 7 },
        ]);
        const [labels] = await admin<{ labelled: number }[]>`
          select count(*)::int as labelled from app.agent_grants
          where owner_id = ${hostA.userId} and last_used_at is not null and client_label is not null
        `;
        expect(labels?.labelled).toBe(2);
      } finally {
        await admin.end({ timeout: 0 });
      }
    } finally {
      await adminClient(local).deleteUser(hostA.userId);
      await adminClient(local).deleteUser(hostB.userId);
    }
  });

  it('ends a token on revoke, expiry, revoke all and TOTP removal, and mails on creation', async () => {
    const local = localStack as LocalStack;
    const host = await verifiedHost(local, 'agent-life');
    const admin = localAdmin();
    try {
      const listOk = async (token: string) => (await mcp(token, 'tools/list')).status;
      const revoked = await createToken(host, { name: 'Revoked' });
      const expired = await createToken(host, { name: 'Expired' });
      const all = await createToken(host, { name: 'Revoke all' });
      expect(await listOk(revoked)).toBe(200);

      const access = decode<{ grants: { id: string; name: string }[] }>(
        await agentFn('getAgentAccess', { jar: host.jar }),
      )?.result;
      const revokedId = access?.grants.find((grant) => grant.name === 'Revoked')?.id;
      expect(
        decode(await agentFn('revokeAgentToken', { jar: host.jar, data: { grantId: revokedId } }))?.result,
      ).toEqual({
        ok: true,
      });
      expect(await listOk(revoked)).toBe(401);

      await admin`update app.agent_grants set created_at = now() - interval '10 days', expires_at = now() - interval '1 second'
        where owner_id = ${host.userId} and name = 'Expired'`;
      expect(await listOk(expired)).toBe(401);

      expect(decode(await agentFn('revokeAllAgentTokens', { jar: host.jar, data: {} }))?.result).toEqual({ ok: true });
      expect(await listOk(all)).toBe(401);

      const survivor = await createToken(host, { name: 'Until TOTP removal' });
      expect(await listOk(survivor)).toBe(200);
      const state = decode<{ totpFactorIds: string[] }>(
        await fnCall(HOST_FNS, 'getHostAuthState', { jar: host.jar }),
      )?.result;
      expect(
        decode(await fnCall(HOST_FNS, 'mfaUnenroll', { jar: host.jar, data: { factorId: state?.totpFactorIds[0] } }))
          ?.result,
      ).toEqual({ ok: true });
      expect(await listOk(survivor)).toBe(401);

      const actions = await admin<{ action: string }[]>`
        select action from app.audit_events where actor_id = ${host.userId} and action like 'agent_grant%' order by id
      `;
      expect(actions.map((row) => row.action)).toEqual([
        'agent_grant_created',
        'agent_grant_created',
        'agent_grant_created',
        'agent_grant_revoked',
        'agent_grants_revoked_all',
        'agent_grant_created',
        'agent_grants_revoked_all',
      ]);
      const mail = (await (
        await fetch(
          `${local.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${host.email} "agent access token"`)}`,
        )
      ).json()) as { messages_count: number };
      expect(mail.messages_count).toBe(4);
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
      await fetch(`${local.mailpitUrl}/api/v1/search?query=to:${encodeURIComponent(host.email)}`, { method: 'DELETE' });
    }
  });

  it('rejects foreign origins before auth and caps each token window', async () => {
    const forbidden = await mcp('not-a-token', 'tools/list', undefined, { origin: 'https://evil.example' });
    expect(forbidden.status).toBe(403);
    expect((await fetch(`${APP}/mcp`)).status).toBe(405);

    const principal = { grantId: randomUUID(), ownerId: randomUUID(), scopes: ['read' as const], propertyId: null };
    for (let request = 0; request < agentLimits.perToken; request += 1) {
      expect(await agentRequestAllowed(principal)).toBe(true);
    }
    expect(await agentRequestAllowed(principal)).toBe(false);
  });

  it('runs every write tool behind the scope and property boundary, with guard, revision and revert', async () => {
    const local = localStack as LocalStack;
    const hostA = await verifiedHost(local, 'agent-wa');
    const hostB = await verifiedHost(local, 'agent-wb');
    const admin = localAdmin();
    try {
      const [a1, a2, b1] = [
        await seedProperty(hostA.userId, 'Write A one (synthetic)'),
        await seedProperty(hostA.userId, 'Write A two (synthetic)'),
        await seedProperty(hostB.userId, 'Write B (synthetic)'),
      ];
      const [section] = await admin<{ id: string }[]>`
        insert into app.guide_sections (property_id, category, title, body, visibility, published)
        values (${a1}, 'parking', 'Parking', 'Behind the house.', 'guest', true) returning id
      `;
      const [translation] = await admin<{ id: string }[]>`
        insert into app.guide_translations (section_id, locale, title, body, source_revision, source_locale)
        values (${section!.id}, 'de', 'Parken', 'Hinter dem Haus.', 1, 'en') returning id
      `;
      const [message] = await admin<{ id: string }[]>`
        select id from app.guest_messages where property_id = ${a1}
      `;
      const [seeded] = await admin<{ id: string }[]>`select id from app.reservations where property_id = ${a1}`;
      const tokenA = await createToken(hostA, { name: 'Writer A', scopes: allScopes });
      const tokenA1 = await createToken(hostA, { name: 'Writer A one', scopes: allScopes, propertyId: a1 });
      const tokenB = await createToken(hostB, { name: 'Writer B', scopes: allScopes });
      const readOnly = await createToken(hostA, { name: 'Reader A' });
      const outputs: Rpc[] = [];
      const ok = async (name: string, args: Record<string, unknown>, token = tokenA) => {
        const output = await call(token, name, args);
        outputs.push(output);
        expect(output.result?.isError, `${name}: ${JSON.stringify(output)}`).toBeUndefined();
        return output.result?.structuredContent as Record<string, unknown>;
      };
      const refused = async (name: string, args: Record<string, unknown>, token = tokenA) => {
        const output = await call(token, name, args);
        outputs.push(output);
        expect(output.error ?? output.result?.isError, `${name}: ${JSON.stringify(output)}`).toBeTruthy();
        return output.result?.content?.[0]?.text ?? output.error?.message ?? '';
      };

      // Idempotent import: the same batch twice leaves one row per (source, external id).
      const batch = {
        propertyId: a1,
        reservations: [1, 2, 3].map((n) => ({
          source: 'booking',
          externalId: `SYN-${n}`,
          stayStart: '2027-03-0' + n,
          stayEnd: '2027-03-0' + (n + 3),
        })),
      };
      expect(await ok('upsert_reservations', batch)).toMatchObject({ created: 3, updated: 0 });
      expect(await ok('upsert_reservations', batch)).toMatchObject({ created: 0, updated: 3 });
      const [{ count }] =
        (await admin`select count(*)::int as count from app.reservations where property_id = ${a1}`) as [
          { count: number },
        ];
      expect(count).toBe(4);
      const tooMany = {
        propertyId: a1,
        reservations: Array.from({ length: 101 }, (_, n) => ({
          source: 'booking',
          externalId: `BIG-${n}`,
          stayStart: '2027-04-01',
          stayEnd: '2027-04-02',
        })),
      };
      await refused('upsert_reservations', tooMany);
      const withGuest = { propertyId: a1, reservations: [{ ...batch.reservations[0], guestFirstName: 'Ana' }] };
      await refused('upsert_reservations', withGuest);
      const [{ big }] =
        (await admin`select count(*)::int as big from app.reservations where external_id like 'BIG-%'`) as [
          { big: number },
        ];
      expect(big).toBe(0);

      // A stay link for an existing reservation returns ids and expiry, never a secret or link id.
      const [imported] = await admin<{ id: string }[]>`
        select id from app.reservations where property_id = ${a1} and external_id = 'SYN-1'
      `;
      const link = await ok('create_stay_link', { propertyId: a1, reservationId: imported!.id });
      expect(Object.keys(link).sort()).toEqual(['expiresAt', 'reservationId']);
      const [stored] = await admin<{ id: string }[]>`
        select id from app.share_links where reservation_id = ${imported!.id} and enabled
      `;
      expect(JSON.stringify(outputs.at(-1))).not.toContain(stored!.id);
      expect(await refused('create_stay_link', { propertyId: a1, reservationId: imported!.id })).toContain(
        'already has a link',
      );
      const reissued = decode<{ shareId: string; secret: string }>(
        await fnCall(SHARE_FNS, 'reissueStayGuestLink', {
          jar: hostA.jar,
          data: { propertyId: a1, reservationId: imported!.id },
        }),
      )?.result;
      expect(reissued?.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const live = await admin<{ id: string }[]>`
        select id from app.share_links where reservation_id = ${imported!.id} and enabled
      `;
      expect(live.map((row) => row.id)).toEqual([reissued?.shareId]);
      expect(await ok('revoke_stay_link', { propertyId: a1, reservationId: imported!.id })).toEqual({
        id: imported!.id,
        changed: true,
      });
      const linkAudits = await admin<{ action: string; name: string | null }[]>`
        select e.action, g.name from app.audit_events e left join app.agent_grants g on g.id = e.grant_id
        where e.actor_id = ${hostA.userId} and e.action in ('stay_link_created', 'stay_link_revoked')
      `;
      expect(linkAudits.map((row) => `${row.action}:${row.name ?? 'host'}`).sort()).toEqual([
        'stay_link_created:Writer A',
        'stay_link_created:host',
        'stay_link_revoked:Writer A',
        'stay_link_revoked:host',
      ]);

      // Guide writes: live, guarded against added contact details, revisioned and revertible.
      const edited = await ok('upsert_section', {
        propertyId: a1,
        sectionId: section!.id,
        title: 'Parking',
        body: 'Behind the house, second bay.',
      });
      expect(edited).toMatchObject({ sectionId: section!.id, created: false });
      expect(
        await refused('upsert_section', {
          propertyId: a1,
          sectionId: section!.id,
          title: 'Parking',
          body: 'Pay for parking at https://evil.example/pay',
        }),
      ).toContain('cannot add a new link');
      await ok('upsert_section', {
        propertyId: a1,
        sectionId: section!.id,
        title: 'Parking',
        body: 'Behind the house, third bay.',
      });
      const added = await ok('upsert_section', {
        propertyId: a1,
        category: 'waste',
        title: 'Waste',
        body: 'Bins by the gate.',
      });
      expect(added).toMatchObject({ created: true });
      const [draft] = await admin<{ published: boolean }[]>`
        select published from app.guide_sections where id = ${added.sectionId as string}
      `;
      expect(draft?.published).toBe(false);
      const agentChange = async (sectionId: string) =>
        decode<{ editor: { sections: { id: string; agentChange: Record<string, unknown> | null }[] } }>(
          await fnCall(GUIDE_FNS, 'getPropertyEditor', { jar: hostA.jar, data: { propertyId: a1 } }),
        )?.result?.editor.sections.find((row) => row.id === sectionId)?.agentChange;
      const revert = async (revisionId: unknown) =>
        decode<{ body: string }>(
          await fnCall(GUIDE_FNS, 'revertAgentChange', { jar: hostA.jar, data: { propertyId: a1, revisionId } }),
        )?.result?.body;
      expect(await agentChange(added.sectionId as string)).toMatchObject({ revertible: false });
      // Reverting the latest of two agent edits exposes the earlier one, still marked and revertible.
      const latest = await agentChange(section!.id);
      expect(latest).toMatchObject({ grantName: 'Writer A', revertible: true });
      expect(await revert(latest?.revisionId)).toBe('Behind the house, second bay.');
      const earlier = await agentChange(section!.id);
      expect(earlier).toMatchObject({ grantName: 'Writer A', revertible: true });
      expect(earlier?.revisionId).not.toBe(latest?.revisionId);
      expect(await revert(earlier?.revisionId)).toBe('Behind the house.');
      expect(await agentChange(section!.id)).toBeNull();
      const [restored] = await admin<{ body: string }[]>`select body from app.guide_sections where id = ${section!.id}`;
      expect(restored?.body).toBe('Behind the house.');
      expect(await ok('move_section', { propertyId: a1, sectionId: section!.id, direction: 'up' })).toMatchObject({
        changed: true,
      });

      expect(
        await refused('review_translation', {
          propertyId: a1,
          translationId: translation!.id,
          decision: 'approve',
          body: 'Fragen an refunds@evil.example',
        }),
      ).toContain('email address');
      // The revert bumped the source revision, so this draft is now out of date.
      expect(
        await refused('review_translation', { propertyId: a1, translationId: translation!.id, decision: 'approve' }),
      ).toContain('out of date');

      expect(await ok('update_property', { propertyId: a1, displayName: 'Write A one, renamed' })).toMatchObject({
        changed: true,
      });
      await refused('update_property', { propertyId: a1, contactPhone: '12 34 56 78' });
      await refused('update_property', { propertyId: a1, wifiPassword: 'agent-set' });
      await refused('update_property', { propertyId: a1, alertEmail: 'agent@evil.example' });

      expect(await ok('mark_inbox_handled', { propertyId: a1, messageId: message!.id })).toEqual({
        id: message!.id,
        changed: true,
      });
      expect(await ok('mark_inbox_handled', { propertyId: a1, messageId: message!.id })).toEqual({
        id: message!.id,
        changed: false,
      });

      // BOLA per write tool: another host's ids look missing, and a restricted token stays on its property.
      const foreign: [string, Record<string, unknown>][] = [
        ['update_property', { propertyId: a1, displayName: 'Taken over' }],
        ['upsert_section', { propertyId: a1, sectionId: section!.id, title: 'X', body: 'Y' }],
        ['upsert_section', { propertyId: a1, category: 'rules', title: 'X', body: 'Y' }],
        ['move_section', { propertyId: a1, sectionId: section!.id, direction: 'down' }],
        ['review_translation', { propertyId: a1, translationId: translation!.id, decision: 'reject' }],
        ['upsert_reservations', batch],
        ['create_stay_link', { propertyId: a1, reservationId: seeded!.id }],
        ['revoke_stay_link', { propertyId: a1, reservationId: imported!.id }],
        ['mark_inbox_handled', { propertyId: a1, messageId: message!.id }],
      ];
      for (const [name, args] of foreign) {
        expect(await refused(name, args, tokenB)).toBe('Not found.');
        expect(await refused(name, { ...args, propertyId: a2 }, tokenA1)).toContain('does not allow');
        await refused(name, args, readOnly);
      }
      const [a2Ids] = await admin<{ section: string; reservation: string; message: string }[]>`
        select (select id from app.guide_sections where property_id = ${a2}) as section,
          (select id from app.reservations where property_id = ${a2}) as reservation,
          (select id from app.guest_messages where property_id = ${a2}) as message
      `;
      const mixed: [string, Record<string, unknown>][] = [
        ['upsert_section', { propertyId: a1, sectionId: a2Ids!.section, title: 'X', body: 'Y' }],
        ['move_section', { propertyId: a1, sectionId: a2Ids!.section, direction: 'down' }],
        ['create_stay_link', { propertyId: a1, reservationId: a2Ids!.reservation }],
        ['revoke_stay_link', { propertyId: a1, reservationId: a2Ids!.reservation }],
        ['mark_inbox_handled', { propertyId: a1, messageId: a2Ids!.message }],
      ];
      for (const [name, args] of mixed) expect(await refused(name, args, tokenA1)).toBe('Not found.');
      const [untouched] = await admin<{ display_name: string; sections: number; links: number }[]>`
        select p.display_name,
          (select count(*)::int from app.guide_sections s where s.property_id = p.id) as sections,
          (select count(*)::int from app.share_links l where l.reservation_id = ${seeded!.id}) as links
        from app.properties p where p.id = ${a1}
      `;
      expect(untouched).toEqual({ display_name: 'Write A one, renamed', sections: 3, links: 0 });
      const [{ reservations }] = (await admin`
        select count(*)::int as reservations from app.reservations where property_id = ${b1}
      `) as [{ reservations: number }];
      expect(reservations).toBe(1);

      for (const output of outputs) {
        const text = JSON.stringify(output);
        for (const secret of Object.values(secrets)) expect(text).not.toContain(secret);
        expect(text).not.toContain(reissued!.secret);
      }
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(hostA.userId);
      await adminClient(local).deleteUser(hostB.userId);
    }
  });

  it('limits failed requests per client IP, writes per token, and requests per host', async () => {
    const ip = { 'x-nf-client-connection-ip': `198.51.100.${Math.floor(Math.random() * 250) + 1}` };
    const statuses: number[] = [];
    for (let request = 0; request <= agentLimits.failuresPerIp; request += 1) {
      statuses.push((await mcp(`sw_pat_${'B'.repeat(43)}`, 'tools/list', undefined, ip)).status);
    }
    expect(statuses.slice(0, -1).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    const writer = { grantId: randomUUID(), ownerId: randomUUID(), scopes: ['inbox:write' as const], propertyId: null };
    for (let write = 0; write < agentLimits.writesPerToken; write += 1) {
      expect(await agentWriteAllowed(writer)).toBe(true);
    }
    expect(await agentWriteAllowed(writer)).toBe(false);

    const ownerId = randomUUID();
    const grant = () => ({ grantId: randomUUID(), ownerId, scopes: ['read' as const], propertyId: null });
    for (const principal of [grant(), grant()]) {
      for (let request = 0; request < agentLimits.perHost / 2; request += 1) {
        expect(await agentRequestAllowed(principal)).toBe(true);
      }
    }
    expect(await agentRequestAllowed(grant())).toBe(false);
  });
});
