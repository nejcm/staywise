// Agent access (MCP) against the real local stack and dev server: token lifecycle through the settings
// server functions, output allowlists, and cross-property (BOLA) checks per tool. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { agentLimits, agentRequestAllowed } from '../features/agent/agent-auth.server';
import { sql } from '../lib/db.server';
import {
  APP,
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

type Rpc = { status: number; result?: Record<string, unknown> & { isError?: boolean; structuredContent?: unknown } };

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
  return { status: response.status, ...(JSON.parse(json) as { result?: Rpc['result'] }) };
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
});
