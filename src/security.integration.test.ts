// Host-auth trust-boundary regressions against the real local stack and dev server.
// Requires `bun run db:start` and `bun run dev`; runs inside `bun run test` and skips without them.
// Run directly with: bun run test:local (synthetic data only; never a remote environment).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServerClient } from '@supabase/ssr';
import postgres from 'postgres';
import { fromCrossJSON, toJSON } from 'seroval';
import { describe, expect, it } from 'vitest';
import { withOwnerContext } from './db.server';
import { parseServerEnv } from './env.server';

const APP = 'http://localhost:3000';
const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322';
const SERVER_FN_SPLIT = '/src/host-fns.ts?tss-serverfn-split';
const SYNTHETIC_PASSWORD = 'synthetic-integration-pw-1';

type LocalStack = { apiUrl: string; serviceKey: string; anonKey: string; mailpitUrl: string };

function detectLocalStack(): LocalStack | null {
  try {
    const status = JSON.parse(
      execFileSync('bunx', ['supabase@2.121.0', 'status', '-o', 'json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ) as Record<string, string>;
    if (!status.API_URL || !status.SERVICE_ROLE_KEY || !status.ANON_KEY) return null;
    return {
      apiUrl: status.API_URL,
      serviceKey: status.SERVICE_ROLE_KEY,
      anonKey: status.ANON_KEY,
      mailpitUrl: status.MAILPIT_URL ?? 'http://127.0.0.1:54324',
    };
  } catch {
    return null;
  }
}

async function detectLocalDb(): Promise<boolean> {
  const probe = postgres(LOCAL_DB_URL, { prepare: false, max: 1 });
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 0 });
  }
}

async function detectDevServer(): Promise<boolean> {
  try {
    const response = await fetch(`${APP}/auth/sign-in`, { redirect: 'manual' });
    return response.status === 200;
  } catch {
    return false;
  }
}

const stack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = stack && localDbUp && devServerUp ? describe : describe.skip;

function serverFnId(name: string): string {
  return Buffer.from(JSON.stringify({ file: SERVER_FN_SPLIT, export: `${name}_createServerFn_handler` })).toString(
    'base64url',
  );
}

type Jar = ReturnType<typeof memoryJar>;

function memoryJar() {
  const store = new Map<string, string>();
  return {
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    setAll: (cookies: { name: string; value: string }[]) => {
      for (const { name, value } of cookies) {
        if (value === '') store.delete(name);
        else store.set(name, value);
      }
    },
    set: (name: string, value: string) => void store.set(name, value),
    remove: (name: string) => void store.delete(name),
    header: () => [...store].map(([name, value]) => `${name}=${value}`).join('; '),
    sessionCount: () => [...store.keys()].filter((name) => /^sb-.*-auth-token(\.\d+)?$/.test(name)).length,
  };
}

function absorbSetCookies(jar: Jar, setCookies: string[]) {
  for (const header of setCookies) {
    const pair = header.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the raw value; cookie values here are base64url without escapes.
    }
    if (value === '') jar.remove(name);
    else jar.set(name, value);
  }
}

type FnReply = { status: number; body: string; setCookies: string[] };

async function fnCall(name: string, options: { cookie?: string; jar?: Jar; data?: unknown } = {}): Promise<FnReply> {
  const headers: Record<string, string> = { 'x-tsr-serverfn': 'true', origin: APP, referer: `${APP}/` };
  const cookie = options.cookie ?? options.jar?.header();
  if (cookie) headers.cookie = cookie;
  if (options.data !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${APP}/_serverFn/${serverFnId(name)}`, {
    method: options.data === undefined ? 'GET' : 'POST',
    headers,
    body: options.data === undefined ? undefined : JSON.stringify(toJSON({ data: options.data })),
    redirect: 'manual',
  });
  const reply = { status: response.status, body: await response.text(), setCookies: response.headers.getSetCookie() };
  if (options.jar) absorbSetCookies(options.jar, reply.setCookies);
  return reply;
}

// Server functions answer with a cross-JSON envelope: {result} for success, {error} for results
// normalized by runGuarded.
type Envelope<T> = { result?: T; error?: string };

function decode<T>(reply: FnReply): Envelope<T> | null {
  try {
    return fromCrossJSON<Envelope<T>>(JSON.parse(reply.body), { refs: new Map() });
  } catch {
    return null;
  }
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value >= 0) bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function adminClient(local: LocalStack) {
  const headers = {
    Authorization: `Bearer ${local.serviceKey}`,
    apikey: local.anonKey,
    'content-type': 'application/json',
  };
  return {
    createUser: async (email: string, password?: string) => {
      const response = await fetch(`${local.apiUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, email_confirm: true, ...(password ? { password } : {}) }),
      });
      const user = (await response.json()) as { id?: string };
      if (!user.id) throw new Error('synthetic admin user creation failed');
      return user.id;
    },
    deleteUser: (id: string) => fetch(`${local.apiUrl}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers }),
  };
}

// The local cluster's superuser-less admin role can only be reached by literal SQL; all values
// in these probes are single-line synthetic ASCII.
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

function localAdmin(db = 'postgres') {
  return postgres(`${LOCAL_DB_URL}/${db}`, { prepare: false, max: 1 });
}

function runtimeClient(password: string, db = 'postgres') {
  return postgres(`postgresql://app_runtime:${password}@127.0.0.1:54322/${db}`, { prepare: false, max: 1 });
}

const migrationFiles = readdirSync(fileURLToPath(new URL('../supabase/migrations', import.meta.url)))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url)));

const PROPERTY_NAME = 'Integration replay property (synthetic)';

describeLocal('host auth trust boundaries against the local stack', () => {
  it('acknowledges invited and unknown addresses identically (no enumeration)', async () => {
    const local = stack as LocalStack;
    const admin = adminClient(local);
    const stamp = Date.now();
    const knownEmail = `security-known-${stamp}@example.test`;
    const unknownEmail = `security-absent-${stamp}@example.test`;
    const knownUserId = await admin.createUser(knownEmail);
    try {
      const known = await fnCall('requestMagicLink', { data: { email: knownEmail } });
      const unknown = await fnCall('requestMagicLink', { data: { email: unknownEmail } });
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

  it('denies revoked sessions, clears their cookies, and recovers interrupted enrollment', async () => {
    const local = stack as LocalStack;
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
      const first = decode<{ factorId: string; secret: string }>(await fnCall('mfaEnroll', { jar, data: {} }))?.result;
      expect(first?.secret).toMatch(/^[A-Z2-7]{32}$/);
      const restarted = decode<{ factorId: string; secret: string }>(
        await fnCall('restartEnrollment', { jar, data: {} }),
      )?.result;
      expect(restarted?.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(restarted?.factorId).not.toBe(first?.factorId);
      const staleFactor = decode<{ error?: string }>(
        await fnCall('mfaVerify', { jar, data: { factorId: first?.factorId, code: totp(first?.secret ?? '') } }),
      );
      expect(staleFactor?.result?.error).toBeDefined();

      const verified = decode<{ ok?: boolean }>(
        await fnCall('mfaVerify', {
          jar,
          data: { factorId: restarted?.factorId, code: totp(restarted?.secret ?? '') },
        }),
      )?.result;
      expect(verified?.ok).toBe(true);
      const workspace = decode<{ state?: string; totpFactorIds?: string[] }>(
        await fnCall('getHostAuthState', { jar }),
      )?.result;
      expect(workspace?.state).toBe('workspace');
      expect(workspace?.totpFactorIds).toEqual([restarted?.factorId]);

      // Restarting with a verified factor present must never unenroll it.
      await fnCall('restartEnrollment', { jar, data: {} });
      const afterRestart = decode<{ state?: string; totpFactorIds?: string[] }>(
        await fnCall('getHostAuthState', { jar }),
      )?.result;
      expect(afterRestart?.state).toBe('workspace');
      expect(afterRestart?.totpFactorIds).toEqual([restarted?.factorId]);

      const owned = decode<{ properties?: { displayName: string }[] }>(
        await fnCall('listOwnProperties', { jar }),
      )?.result;
      expect(owned?.properties?.map((property) => property.displayName)).toContain(PROPERTY_NAME);

      // Real sign-out through the app endpoint, then replay the captured AAL2 cookies.
      const replayCookie = jar.header();
      const revoked = await fnCall('signOut', { jar, data: {} });
      expect(decode<{ ok?: boolean }>(revoked)?.result?.ok).toBe(true);
      expect(jar.sessionCount()).toBe(0);

      const replay = await fnCall('listOwnProperties', { cookie: replayCookie });
      expect(decode<{ error?: string }>(replay)?.result?.error).toBe('auth_required');
      expect(replay.body).not.toContain(PROPERTY_NAME);
      expect(
        replay.setCookies.some((header) => /^sb-.*-auth-token(\.\d+)?=;/.test(header) && header.includes('Max-Age=0')),
      ).toBe(true);

      const replayState = await fnCall('getHostAuthState', { cookie: replayCookie });
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
    const local = stack as LocalStack;
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
        await fnCall('mfaEnroll', { jar, data: {} }),
      )?.result;
      const verified = decode<{ ok?: boolean }>(
        await fnCall('mfaVerify', { jar, data: { factorId: enrolled?.factorId, code: totp(enrolled?.secret ?? '') } }),
      )?.result;
      expect(verified?.ok).toBe(true);

      const signedOut = await fnCall('signOut', { jar, data: {} });
      expect(decode<{ ok?: boolean }>(signedOut)?.result?.ok).toBe(true);
      expect(jar.sessionCount()).toBe(0);

      // A second sign-in with a verified factor lands at AAL1: the exact state a host steps up from.
      await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });
      expect(jar.sessionCount()).toBeGreaterThan(0);

      const denied = await fnCall('listOwnProperties', { jar });
      expect(decode<{ error?: string }>(denied)?.result?.error).toBe('auth_required');
      expect(
        denied.setCookies.some((header) => /^sb-.*-auth-token(\.\d+)?=;/.test(header) && header.includes('Max-Age=0')),
      ).toBe(false);
      expect(jar.sessionCount()).toBeGreaterThan(0);

      const steppedUp = decode<{ ok?: boolean }>(
        await fnCall('mfaVerify', { jar, data: { factorId: enrolled?.factorId, code: totp(enrolled?.secret ?? '') } }),
      )?.result;
      expect(steppedUp?.ok).toBe(true);
      const workspace = decode<{ state?: string }>(await fnCall('getHostAuthState', { jar }))?.result;
      expect(workspace?.state).toBe('workspace');
    } finally {
      await admin.deleteUser(userId);
    }
  }, 60_000);

  it('preserves a pre-provisioned runtime password when the shared migrations run', async () => {
    const localPassword = new URL(parseServerEnv({ APP_ENV: 'local' }).appDbUrl).password;
    const preprovisioned = 'synthetic-preprovisioned-pw-1';
    const scratchDb = `synthetic_role_probe_${Date.now()}`;
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
});
