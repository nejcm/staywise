// Host-auth trust-boundary regressions against the real local stack and dev server.
// Requires `bun run db:start` and `bun run dev`; runs inside `bun run test` and skips without them.
// Run directly with: bun run test:local (synthetic data only; never a remote environment).
import { readFileSync } from 'node:fs';
import { createServerClient } from '@supabase/ssr';
import { describe, expect, it } from 'vitest';
import { otpLimits, otpSendAllowed } from '../features/auth/auth-limits.server';
import { withOwnerContext } from '../lib/db.server';
import { parseServerEnv } from '../lib/env.server';
import {
  APP,
  HOST_FNS,
  SYNTHETIC_PASSWORD,
  adminClient,
  decode,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  fnCall,
  localAdmin,
  memoryJar,
  migrationFiles,
  quoteLiteral,
  runtimeClient,
  totp,
  type LocalStack,
} from './integration-helpers';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp ? describe : describe.skip;

const hostFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(HOST_FNS, name, options);

const PROPERTY_NAME = 'Integration replay property (synthetic)';

describeLocal('host auth trust boundaries against the local stack', () => {
  it('acknowledges invited and unknown addresses identically (no enumeration)', async () => {
    const local = localStack as LocalStack;
    const admin = adminClient(local);
    const stamp = Date.now();
    const knownEmail = `security-known-${stamp}@example.test`;
    const unknownEmail = `security-absent-${stamp}@example.test`;
    const knownUserId = await admin.createUser(knownEmail);
    try {
      const known = await hostFn('requestMagicLink', { data: { email: knownEmail } });
      const unknown = await hostFn('requestMagicLink', { data: { email: unknownEmail } });
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(decode<{ ok: true }>(known)).toEqual(decode<{ ok: true }>(unknown));
      expect(decode<{ ok: true }>(known)).toEqual({ result: { ok: true } });
      expect(known.body).not.toContain(knownEmail);
      expect(unknown.body).not.toContain(unknownEmail);
    } finally {
      await admin.deleteUser(knownUserId);
      await fetch(`${local.mailpitUrl}/api/v1/search?query=to:${encodeURIComponent(knownEmail)}`, { method: 'DELETE' });
    }
  }, 30_000);

  it('limits OTP sends per client IP and per address without changing the acknowledgement', async () => {
    const stamp = Date.now();
    const email = `security-otp-${stamp}@example.test`;
    for (let attempt = 0; attempt < otpLimits.perEmail; attempt += 1) {
      expect(await otpSendAllowed({ email, clientIp: null })).toBe(true);
    }
    expect(await otpSendAllowed({ email: email.toUpperCase(), clientIp: null })).toBe(false);
    const limited = await hostFn('requestMagicLink', { data: { email } });
    expect(decode<{ ok: true }>(limited)).toEqual({ result: { ok: true } });

    const clientIp = `198.51.100.${stamp % 250}-${stamp}`;
    for (let attempt = 0; attempt < otpLimits.perIp; attempt += 1) {
      expect(await otpSendAllowed({ email: `security-otp-ip-${stamp}-${attempt}@example.test`, clientIp })).toBe(true);
    }
    const fresh = `security-otp-fresh-${stamp}@example.test`;
    expect(await otpSendAllowed({ email: fresh, clientIp })).toBe(false);
    // The IP denial stopped before the address window, so that address still has its full budget.
    for (let attempt = 0; attempt < otpLimits.perEmail; attempt += 1) {
      expect(await otpSendAllowed({ email: fresh, clientIp: null })).toBe(true);
    }
  }, 30_000);

  it('denies revoked sessions, clears their cookies, and recovers interrupted enrollment', async () => {
    const local = localStack as LocalStack;
    const admin = adminClient(local);
    const email = `security-replay-${Date.now()}@example.test`;
    const userId = await admin.createUser(email, SYNTHETIC_PASSWORD);
    try {
      await withOwnerContext(
        userId,
        (tx) => tx`insert into app.properties (owner_id, display_name) values (${userId}, ${PROPERTY_NAME})`,
      );

      const jar = memoryJar();
      const client = createServerClient(local.apiUrl, local.anonKey, {
        cookies: { getAll: jar.getAll, setAll: jar.setAll },
      });
      const signIn = await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });
      expect(signIn.error).toBeNull();
      expect(jar.sessionCount()).toBeGreaterThan(0);

      // Interrupted enrollment: start, then restart without ever storing the first secret.
      const first = decode<{ factorId: string; secret: string }>(await hostFn('mfaEnroll', { jar, data: {} }))?.result;
      expect(first?.secret).toMatch(/^[A-Z2-7]{32}$/);
      const restarted = decode<{ factorId: string; secret: string }>(
        await hostFn('restartEnrollment', { jar, data: {} }),
      )?.result;
      expect(restarted?.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(restarted?.factorId).not.toBe(first?.factorId);
      const staleFactor = decode<{ error?: string }>(
        await hostFn('mfaVerify', { jar, data: { factorId: first?.factorId, code: totp(first?.secret ?? '') } }),
      );
      expect(staleFactor?.result?.error).toBeDefined();

      const verified = decode<{ ok?: boolean }>(
        await hostFn('mfaVerify', {
          jar,
          data: { factorId: restarted?.factorId, code: totp(restarted?.secret ?? '') },
        }),
      )?.result;
      expect(verified?.ok).toBe(true);
      const workspace = decode<{ state?: string; totpFactorIds?: string[] }>(
        await hostFn('getHostAuthState', { jar }),
      )?.result;
      expect(workspace?.state).toBe('workspace');
      expect(workspace?.totpFactorIds).toEqual([restarted?.factorId]);

      // Restarting with a verified factor present must never unenroll it.
      await hostFn('restartEnrollment', { jar, data: {} });
      const afterRestart = decode<{ state?: string; totpFactorIds?: string[] }>(
        await hostFn('getHostAuthState', { jar }),
      )?.result;
      expect(afterRestart?.state).toBe('workspace');
      expect(afterRestart?.totpFactorIds).toEqual([restarted?.factorId]);

      const owned = decode<{ properties?: { displayName: string }[] }>(
        await hostFn('listOwnProperties', { jar }),
      )?.result;
      expect(owned?.properties?.map((property) => property.displayName)).toContain(PROPERTY_NAME);

      // Real sign-out through the app endpoint, then replay the captured AAL2 cookies.
      const replayCookie = jar.header();
      const revoked = await hostFn('signOut', { jar, data: {} });
      expect(decode<{ ok?: boolean }>(revoked)?.result?.ok).toBe(true);
      expect(jar.sessionCount()).toBe(0);

      const replay = await hostFn('listOwnProperties', { cookie: replayCookie });
      expect(decode<{ error?: string }>(replay)?.result?.error).toBe('auth_required');
      expect(replay.body).not.toContain(PROPERTY_NAME);
      expect(
        replay.setCookies.some((header) => /^sb-.*-auth-token(\.\d+)?=;/.test(header) && header.includes('Max-Age=0')),
      ).toBe(true);

      const replayState = await hostFn('getHostAuthState', { cookie: replayCookie });
      expect(decode<{ state?: string }>(replayState)?.result?.state).toBe('signed_out');

      const ssr = await fetch(`${APP}/host`, { headers: { cookie: replayCookie }, redirect: 'manual' });
      expect(ssr.status).toBeGreaterThanOrEqual(300);
      expect(ssr.status).toBeLessThan(400);
      expect(ssr.headers.get('location')).toContain('/auth/sign-in');
      expect(await ssr.text()).not.toContain(PROPERTY_NAME);

      const signInDoc = await fetch(`${APP}/auth/sign-in`, { headers: { cookie: replayCookie } });
      expect(signInDoc.status).toBe(200);
      expect(
        signInDoc.headers
          .getSetCookie()
          .some((header) => /^sb-.*-auth-token(\.\d+)?=;/.test(header) && header.includes('Max-Age=0')),
      ).toBe(true);
    } finally {
      await admin.deleteUser(userId);
    }
  }, 60_000);

  it('keeps a valid AAL1 session after an AAL2-gated denial so the step-up can finish', async () => {
    const local = localStack as LocalStack;
    const admin = adminClient(local);
    const email = `security-stepup-${Date.now()}@example.test`;
    const userId = await admin.createUser(email, SYNTHETIC_PASSWORD);
    try {
      const jar = memoryJar();
      const client = createServerClient(local.apiUrl, local.anonKey, {
        cookies: { getAll: jar.getAll, setAll: jar.setAll },
      });
      await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });

      const enrolled = decode<{ factorId: string; secret: string }>(
        await hostFn('mfaEnroll', { jar, data: {} }),
      )?.result;
      const verified = decode<{ ok?: boolean }>(
        await hostFn('mfaVerify', { jar, data: { factorId: enrolled?.factorId, code: totp(enrolled?.secret ?? '') } }),
      )?.result;
      expect(verified?.ok).toBe(true);

      const signedOut = await hostFn('signOut', { jar, data: {} });
      expect(decode<{ ok?: boolean }>(signedOut)?.result?.ok).toBe(true);
      expect(jar.sessionCount()).toBe(0);

      // A second sign-in with a verified factor lands at AAL1: the exact state a host steps up from.
      await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });
      expect(jar.sessionCount()).toBeGreaterThan(0);

      const denied = await hostFn('listOwnProperties', { jar });
      expect(decode<{ error?: string }>(denied)?.result?.error).toBe('auth_required');
      expect(
        denied.setCookies.some((header) => /^sb-.*-auth-token(\.\d+)?=;/.test(header) && header.includes('Max-Age=0')),
      ).toBe(false);
      expect(jar.sessionCount()).toBeGreaterThan(0);

      const steppedUp = decode<{ ok?: boolean }>(
        await hostFn('mfaVerify', { jar, data: { factorId: enrolled?.factorId, code: totp(enrolled?.secret ?? '') } }),
      )?.result;
      expect(steppedUp?.ok).toBe(true);
      const workspace = decode<{ state?: string }>(await hostFn('getHostAuthState', { jar }))?.result;
      expect(workspace?.state).toBe('workspace');
    } finally {
      await admin.deleteUser(userId);
    }
  }, 60_000);

  it('preserves a pre-provisioned runtime password when the shared migrations run', async () => {
    const localPassword = new URL(parseServerEnv({ APP_ENV: 'local' }).appDbUrl).password;
    const preprovisioned = 'synthetic-preprovisioned-pw-1';
    const scratchDb = `scratch_role_probe_${Date.now()}`;
    const admin = localAdmin();
    try {
      await admin.unsafe(`alter role app_runtime password ${quoteLiteral(preprovisioned)}`);
      const [before] = await admin<{ rolpassword: string }[]>`
        select rolpassword from pg_authid where rolname = 'app_runtime'
      `;
      expect(before?.rolpassword).toBeTruthy();

      await admin.unsafe(`create database ${scratchDb}`);
      const scratch = localAdmin(scratchDb);
      try {
        await scratch.unsafe('create schema auth; create table auth.users (id uuid primary key);');
        for (const migration of migrationFiles) await scratch.unsafe(readFileSync(migration, 'utf8'));
      } finally {
        await scratch.end({ timeout: 0 });
      }

      const [after] = await admin<{ rolpassword: string }[]>`
        select rolpassword from pg_authid where rolname = 'app_runtime'
      `;
      expect(after?.rolpassword).toBe(before?.rolpassword);

      const preprovisionedClient = runtimeClient(preprovisioned, scratchDb);
      try {
        const [check] = await preprovisionedClient<{ ok: number }[]>`select 1 as ok`;
        expect(check?.ok).toBe(1);
      } finally {
        await preprovisionedClient.end({ timeout: 0 });
      }
    } finally {
      await admin.unsafe(`drop database if exists ${scratchDb}`);
      await admin.unsafe(`alter role app_runtime password ${quoteLiteral(localPassword)}`);
      await admin.end({ timeout: 0 });
    }

    const restored = runtimeClient(localPassword);
    try {
      const [check] = await restored<{ ok: number }[]>`select 1 as ok`;
      expect(check?.ok).toBe(1);
    } finally {
      await restored.end({ timeout: 0 });
    }
  }, 60_000);
  it('deletes an account only with the typed email and a fresh code, leaving no owner row behind', async () => {
    const local = localStack as LocalStack;
    const email = `security-delete-${Date.now()}@example.test`;
    const userId = await adminClient(local).createUser(email, SYNTHETIC_PASSWORD);
    const db = localAdmin();
    try {
      const [property] = await db<{ id: string }[]>`
        insert into app.properties (owner_id, display_name) values (${userId}, ${PROPERTY_NAME}) returning id
      `;
      const propertyId = property!.id;
      const linkId = `delete${Date.now()}`.slice(0, 20);
      await db`insert into app.host_settings (owner_id) values (${userId})`;
      await db`insert into app.share_links (id, secret_hmac, property_id) values (${linkId}, '\\x01', ${propertyId})`;
      await db`
        insert into app.guest_sessions (id, session_hash, share_link_id, expires_at)
        values (gen_random_uuid(), '\\x02', ${linkId}, now() + interval '1 hour')
      `;
      await db`
        insert into app.guest_messages (property_id, kind, category, body)
        values (${propertyId}, 'question', 'wifi', 'Synthetic unread message')
      `;
      await db`insert into app.setup_events (owner_id, event_type) values (${userId}, 'sign_in')`;
      await db`insert into app.api_tokens (owner_id, token_hash, scopes) values (${userId}, '\\x03', '{content:write}')`;
      await db`insert into app.audit_events (actor_id, action) values (${userId}, 'sign_in')`;
      const [{ since } = { since: new Date(0) }] = await db<{ since: Date }[]>`select now() as since`;

      const jar = memoryJar();
      const client = createServerClient(local.apiUrl, local.anonKey, {
        cookies: { getAll: jar.getAll, setAll: jar.setAll },
      });
      expect((await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD })).error).toBeNull();
      const enrolled = decode<{ factorId: string; secret: string }>(
        await hostFn('mfaEnroll', { jar, data: {} }),
      )?.result;
      expect(
        decode<{ ok?: boolean }>(
          await hostFn('mfaVerify', {
            jar,
            data: { factorId: enrolled?.factorId, code: totp(enrolled?.secret ?? '') },
          }),
        )?.result?.ok,
      ).toBe(true);

      const wrongEmail = await hostFn('deleteAccount', { jar, data: { email: 'someone-else@example.test' } });
      expect(decode<{ error?: string }>(wrongEmail)?.result?.error).toBe('invalid_input');
      const noCode = await hostFn('deleteAccount', { jar, data: { email: email.toUpperCase() } });
      expect(decode<{ error?: string }>(noCode)?.result?.error).toBe('invalid_code');
      const [{ n: kept } = { n: -1 }] = await db<{ n: number }[]>`
        select count(*)::int as n from app.properties where owner_id = ${userId}
      `;
      expect(kept).toBe(1);

      const deleted = await hostFn('deleteAccount', {
        jar,
        data: { email, code: totp(enrolled?.secret ?? '') },
      });
      expect(decode<{ ok?: boolean }>(deleted)?.result?.ok).toBe(true);
      expect(jar.sessionCount()).toBe(0);

      const [left] = await db<Record<string, number>[]>`
        select
          (select count(*)::int from auth.users where id = ${userId}) as users,
          (select count(*)::int from app.properties where owner_id = ${userId}) as properties,
          (select count(*)::int from app.host_settings where owner_id = ${userId}) as settings,
          (select count(*)::int from app.share_links where property_id = ${propertyId}) as links,
          (select count(*)::int from app.guest_sessions where share_link_id = ${linkId}) as sessions,
          (select count(*)::int from app.guest_messages where property_id = ${propertyId}) as messages,
          (select count(*)::int from app.setup_events where owner_id = ${userId}) as setup,
          (select count(*)::int from app.api_tokens where owner_id = ${userId}) as tokens,
          (select count(*)::int from app.audit_events where actor_id = ${userId}) as attributed,
          (select count(*)::int from app.audit_events
            where actor_id is null and action = 'account_deleted' and created_at >= ${since}) as deletions
      `;
      expect(left).toEqual({
        users: 0,
        properties: 0,
        settings: 0,
        links: 0,
        sessions: 0,
        messages: 0,
        setup: 0,
        tokens: 0,
        attributed: 0,
        deletions: 1,
      });
      expect((await client.auth.getUser()).error).not.toBeNull();
    } finally {
      await adminClient(local).deleteUser(userId);
      await db.end({ timeout: 0 });
    }
  }, 30_000);
});
