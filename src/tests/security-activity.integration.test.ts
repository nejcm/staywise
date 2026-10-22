// Settings "Security activity" through the real server function: owner-only, action filter, limit. Synthetic data only.
import { afterAll, describe, expect, it } from 'vitest';
import { readSecurityActivity, type SecurityEvent } from '../features/host/settings.server';
import { sql, withOwnerContext } from '../lib/db.server';
import { createServerClient } from '@supabase/ssr';
import { recordSignIn, signInContext } from '../lib/sign-in-context.server';
import {
  APP,
  HOST_FNS,
  SETTINGS_FNS,
  SYNTHETIC_PASSWORD,
  adminClient,
  decode,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  fnCall,
  localAdmin,
  memoryJar,
  quoteLiteral,
  totp,
  verifiedHost,
  type Jar,
  type LocalStack,
} from './integration-helpers';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp ? describe : describe.skip;

const AGENT_FNS = '/src/features/agent/agent-fns.ts?tss-serverfn-split';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const SYNTHETIC_IP = '198.51.100.77';
const geo = (code: string, city: string) =>
  Buffer.from(JSON.stringify({ city, country: { code, name: code } })).toString('base64');

const hostFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(HOST_FNS, name, options);

function expectNoRawIdentifiers(row: string) {
  expect(row).not.toContain('Mozilla');
  expect(row).not.toContain('Gecko');
  expect(row).not.toContain(SYNTHETIC_IP);
}

async function magicLinkCallback(local: LocalStack, email: string): Promise<{ jar: Jar; callback: string }> {
  const jar = memoryJar();
  const sent = await hostFn('requestMagicLink', {
    jar,
    headers: { 'x-nf-client-connection-ip': `203.0.113.${Date.now() % 250}` },
    data: { email },
  });
  expect(decode<{ ok?: boolean }>(sent)?.result?.ok).toBe(true);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (
      await fetch(`${local.mailpitUrl}/api/v1/search?query=to:${encodeURIComponent(email)}`)
    ).json()) as { messages: { ID: string }[] };
    const id = search.messages[0]?.ID;
    if (id) {
      const { Text } = (await (await fetch(`${local.mailpitUrl}/api/v1/message/${id}`)).json()) as { Text: string };
      const link = Text.match(/https?:\/\/\S+\/auth\/v1\/verify\S+/)?.[0];
      if (link) {
        const verified = await fetch(link, { redirect: 'manual' });
        const location = new URL(verified.headers.get('location') ?? '');
        return { jar, callback: `${location.pathname}${location.search}` };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('magic link email not delivered');
}

async function rejectAuditFor(db: ReturnType<typeof localAdmin>, userId: string) {
  await db.unsafe(`
    create or replace function app.sign_in_context_reject_audit() returns trigger language plpgsql as $$
    begin
      if new.actor_id = ${quoteLiteral(userId)}::uuid then raise exception 'synthetic audit failure'; end if;
      return new;
    end $$;
    drop trigger if exists sign_in_context_reject_audit on app.audit_events;
    create trigger sign_in_context_reject_audit before insert on app.audit_events
      for each row execute function app.sign_in_context_reject_audit();
  `);
}

afterAll(async () => {
  await sql.end({ timeout: 0 });
});

describeLocal('security activity against the local stack', () => {
  it('lists the newest 20 own security events without tool calls or other owners', async () => {
    const local = localStack as LocalStack;
    const hostA = await verifiedHost(local, 'activity-a');
    const hostB = await verifiedHost(local, 'activity-b');
    const admin = localAdmin();
    try {
      const created = await fnCall(AGENT_FNS, 'createAgentToken', {
        jar: hostA.jar,
        data: { name: 'Activity laptop', scopes: ['read'], propertyId: null, days: 30 },
      });
      expect(decode<{ token: string }>(created)?.result?.token).toBeTruthy();
      const [grant] = await admin<{ id: string }[]>`select id from app.agent_grants where owner_id = ${hostA.userId}`;
      const digest = Buffer.alloc(32, 7);
      for (let minute = 1; minute <= 25; minute += 1) {
        await admin`insert into app.audit_events (actor_id, action, created_at)
          values (${hostA.userId}, 'sign_in', now() - make_interval(mins => ${minute}))`;
      }
      await admin`insert into app.audit_events (actor_id, action, created_at) values (${hostA.userId}, 'publish', now() + interval '1 minute')`;
      await admin`insert into app.audit_events (actor_id, action, grant_id, tool, outcome, latency_ms, args_digest, created_at)
        values (${hostA.userId}, 'agent_tool_call', ${grant!.id}, 'list_properties', 'ok', 5, ${digest}, now() + interval '1 minute')`;
      await admin`insert into app.audit_events (actor_id, action, created_at) values (${hostB.userId}, 'sign_in', now() + interval '1 minute')`;

      const reply = await fnCall(SETTINGS_FNS, 'getSecurityActivity', { jar: hostA.jar });
      const events = decode<{ events: SecurityEvent[] }>(reply)?.result?.events ?? [];
      expect(events).toHaveLength(20);
      expect(events.map((event) => event.action).slice(0, 2)).toEqual(['agent_grant_created', 'mfa_enrolled']);
      expect(events[0]?.grantName).toBe('Activity laptop');
      expect(events.slice(2).every((event) => event.action === 'sign_in')).toBe(true);
      const times = events.map((event) => event.at);
      expect([...times].sort().reverse()).toEqual(times);

      const unauthenticated = await fnCall(SETTINGS_FNS, 'getSecurityActivity');
      expect(decode<{ error?: string }>(unauthenticated)?.result?.error).toBeTruthy();
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(hostA.userId);
      await adminClient(local).deleteUser(hostB.userId);
    }
  });

  it('flags a device and country unseen for this owner in the last 90 days', async () => {
    const local = localStack as LocalStack;
    const admin = adminClient(local);
    const userId = await admin.createUser(`synthetic-activity-ctx-${Date.now()}@example.test`);
    const otherId = await admin.createUser(`synthetic-activity-other-${Date.now()}@example.test`);
    const db = localAdmin();
    const context = (ua: string, nfGeo?: string) =>
      signInContext(
        new Headers({
          'user-agent': ua,
          'x-forwarded-for': SYNTHETIC_IP,
          'x-nf-client-connection-ip': SYNTHETIC_IP,
          ...(nfGeo ? { 'x-nf-geo': nfGeo } : {}),
        }),
        true,
      );
    try {
      await recordSignIn(otherId, 'sign_in', context(FIREFOX_LINUX, geo('SI', 'Ljubljana')));
      await db`insert into app.audit_events (actor_id, action, device_label, country_code, new_device, created_at)
        values (${userId}, 'sign_in', 'Safari on iOS', 'SI', false, now() - interval '91 days')`;
      await recordSignIn(userId, 'sign_in', context(FIREFOX_LINUX, geo('SI', 'Ljubljana')));
      await recordSignIn(userId, 'mfa_verified', context(FIREFOX_LINUX, geo('SI', 'Ljubljana')));
      await recordSignIn(userId, 'sign_in', context(SAFARI_IOS, geo('SI', 'Ljubljana')));
      await recordSignIn(userId, 'sign_in', context(FIREFOX_LINUX, geo('AT', 'Vienna')));
      await recordSignIn(userId, 'sign_in', context(FIREFOX_LINUX));

      const events = await withOwnerContext(userId, readSecurityActivity);
      expect(
        events.map(({ action, device, countryCode, city, newDevice }) => [
          action,
          device,
          countryCode,
          city,
          newDevice,
        ]),
      ).toEqual([
        ['sign_in', 'Firefox on Linux', null, null, true],
        ['sign_in', 'Firefox on Linux', 'AT', 'Vienna', true],
        ['sign_in', 'Safari on iOS', 'SI', 'Ljubljana', true],
        ['mfa_verified', 'Firefox on Linux', 'SI', 'Ljubljana', false],
        ['sign_in', 'Firefox on Linux', 'SI', 'Ljubljana', true],
        ['sign_in', 'Safari on iOS', 'SI', null, false],
      ]);
      const rows =
        await db`select to_jsonb(a)::text as row from app.audit_events a where actor_id in ${db([userId, otherId])}`;
      expect(rows).toHaveLength(7);
      for (const { row } of rows) expectNoRawIdentifiers(row);
    } finally {
      await db.end({ timeout: 0 });
      await admin.deleteUser(userId);
      await admin.deleteUser(otherId);
    }
  });

  it('records the email-link callback with its device, ignores forged geo, and audits no failed exchange', async () => {
    const local = localStack as LocalStack;
    const admin = adminClient(local);
    const email = `synthetic-activity-link-${Date.now()}@example.test`;
    const userId = await admin.createUser(email);
    const db = localAdmin();
    try {
      const failed = await fetch(`${APP}/auth/callback?code=synthetic-invalid-code`, { redirect: 'manual' });
      expect(failed.headers.get('location')).toBe('/auth/sign-in?status=restart');

      const { jar, callback } = await magicLinkCallback(local, email);
      const signedIn = await fetch(`${APP}${callback}`, {
        redirect: 'manual',
        headers: {
          cookie: jar.header(),
          'user-agent': FIREFOX_LINUX,
          'x-nf-geo': geo('SI', SYNTHETIC_IP),
          'x-forwarded-for': SYNTHETIC_IP,
        },
      });
      expect(signedIn.status).toBe(303);
      expect(signedIn.headers.get('location')).toBe('/host');
      const rows = await db<
        {
          action: string;
          device_label: string;
          country_code: string | null;
          city: string | null;
          new_device: boolean;
          row: string;
        }[]
      >`
        select action, device_label, country_code, city, new_device, to_jsonb(a)::text as row
        from app.audit_events a where actor_id = ${userId}
      `;
      expect(rows.map(({ row: _row, ...fields }) => fields)).toEqual([
        { action: 'sign_in', device_label: 'Firefox on Linux', country_code: null, city: null, new_device: true },
      ]);
      expectNoRawIdentifiers(rows[0]!.row);
    } finally {
      await db.end({ timeout: 0 });
      await admin.deleteUser(userId);
      await fetch(`${local.mailpitUrl}/api/v1/search?query=to:${encodeURIComponent(email)}`, { method: 'DELETE' });
    }
  }, 60_000);

  it('signs in through the email link when its audit row cannot be written', async () => {
    const local = localStack as LocalStack;
    const admin = adminClient(local);
    const email = `synthetic-activity-noaudit-${Date.now()}@example.test`;
    const userId = await admin.createUser(email);
    const db = localAdmin();
    try {
      const { jar, callback } = await magicLinkCallback(local, email);
      await rejectAuditFor(db, userId);
      const signedIn = await fetch(`${APP}${callback}`, { redirect: 'manual', headers: { cookie: jar.header() } });
      expect(signedIn.headers.get('location')).toBe('/host');
      expect(signedIn.headers.getSetCookie().some((header) => /^sb-.*-auth-token/.test(header))).toBe(true);
      expect(await db`select 1 from app.audit_events where actor_id = ${userId}`).toHaveLength(0);
    } finally {
      await db.unsafe('drop trigger if exists sign_in_context_reject_audit on app.audit_events');
      await db.end({ timeout: 0 });
      await admin.deleteUser(userId);
      await fetch(`${local.mailpitUrl}/api/v1/search?query=to:${encodeURIComponent(email)}`, { method: 'DELETE' });
    }
  }, 60_000);

  it('records an authenticator step-up as mfa_verified, never a rejected code, and survives a failed audit', async () => {
    const local = localStack as LocalStack;
    const admin = adminClient(local);
    const email = `synthetic-activity-totp-${Date.now()}@example.test`;
    const userId = await admin.createUser(email, SYNTHETIC_PASSWORD);
    const db = localAdmin();
    const jar = memoryJar();
    const client = createServerClient(local.apiUrl, local.anonKey, {
      cookies: { getAll: jar.getAll, setAll: jar.setAll },
    });
    const headers = { 'user-agent': SAFARI_IOS, 'x-nf-geo': geo('AT', 'Forged'), 'x-forwarded-for': SYNTHETIC_IP };
    const verify = async (factorId: string, code: string) =>
      decode<{ ok?: boolean; error?: string }>(await hostFn('mfaVerify', { jar, headers, data: { factorId, code } }))
        ?.result;
    const contextRows = () =>
      db<{ action: string; device_label: string | null; country_code: string | null; row: string }[]>`
        select action, device_label, country_code, to_jsonb(a)::text as row
        from app.audit_events a where actor_id = ${userId} order by id
      `;
    try {
      await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });
      const enrolled = decode<{ factorId: string; secret: string }>(
        await hostFn('mfaEnroll', { jar, data: {} }),
      )?.result;
      const factorId = enrolled?.factorId ?? '';
      expect((await verify(factorId, totp(enrolled?.secret ?? '')))?.ok).toBe(true);

      await hostFn('signOut', { jar, data: {} });
      await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });
      const wrong = totp(enrolled?.secret ?? '') === '000000' ? '111111' : '000000';
      expect((await verify(factorId, wrong))?.error).toBe('invalid_code');
      expect((await verify(factorId, totp(enrolled?.secret ?? '')))?.ok).toBe(true);
      const rows = await contextRows();
      expect(rows.map(({ row: _row, ...fields }) => fields)).toEqual([
        { action: 'mfa_enrolled', device_label: null, country_code: null },
        { action: 'mfa_verified', device_label: 'Safari on iOS', country_code: null },
      ]);
      for (const { row } of rows) expectNoRawIdentifiers(row);

      await rejectAuditFor(db, userId);
      await hostFn('signOut', { jar, data: {} });
      await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });
      expect((await verify(factorId, totp(enrolled?.secret ?? '')))?.ok).toBe(true);
      expect(decode<{ state?: string }>(await hostFn('getHostAuthState', { jar }))?.result?.state).toBe('workspace');
      expect(await contextRows()).toHaveLength(2);
    } finally {
      await db.unsafe('drop trigger if exists sign_in_context_reject_audit on app.audit_events');
      await db.end({ timeout: 0 });
      await admin.deleteUser(userId);
    }
  }, 60_000);
});
