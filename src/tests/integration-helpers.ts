// Shared local-stack plumbing for the integration suites: dev-server RPC calls, cookie jars,
// synthetic TOTP, and admin-role database access. Synthetic data only; never a remote environment.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServerClient } from '@supabase/ssr';
import postgres from 'postgres';
import { fromCrossJSON, toJSON } from 'seroval';

export const APP = 'http://localhost:3000';
const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322';
export const HOST_FNS = '/src/features/host/host-fns.ts?tss-serverfn-split';
export const GUIDE_FNS = '/src/features/guide/guide-fns.ts?tss-serverfn-split';
export const SETTINGS_FNS = '/src/features/host/settings-fns.ts?tss-serverfn-split';
export const SYNTHETIC_PASSWORD = 'synthetic-integration-pw-1';

export type LocalStack = { apiUrl: string; serviceKey: string; secretKey: string; anonKey: string; mailpitUrl: string };

export function detectLocalStack(): LocalStack | null {
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
      secretKey: status.SECRET_KEY ?? '',
      anonKey: status.ANON_KEY,
      mailpitUrl: status.MAILPIT_URL ?? 'http://127.0.0.1:54324',
    };
  } catch {
    return null;
  }
}

export async function detectLocalDb(): Promise<boolean> {
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

export async function detectDevServer(): Promise<boolean> {
  try {
    const response = await fetch(`${APP}/auth/sign-in`, { redirect: 'manual' });
    return response.status === 200;
  } catch {
    return false;
  }
}

function serverFnId(file: string, name: string): string {
  return Buffer.from(JSON.stringify({ file, export: `${name}_createServerFn_handler` })).toString('base64url');
}

export type Jar = ReturnType<typeof memoryJar>;

export function memoryJar() {
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

export type FnReply = { status: number; body: string; setCookies: string[] };

export async function fnCall(
  file: string,
  name: string,
  options: { cookie?: string; jar?: Jar; data?: unknown; headers?: Record<string, string> } = {},
): Promise<FnReply> {
  const headers: Record<string, string> = {
    ...options.headers,
    'x-tsr-serverfn': 'true',
    origin: APP,
    referer: `${APP}/`,
  };
  const cookie = options.cookie ?? options.jar?.header();
  if (cookie) headers.cookie = cookie;
  if (options.data !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${APP}/_serverFn/${serverFnId(file, name)}`, {
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
export type Envelope<T> = { result?: T; error?: string };

export function decode<T>(reply: FnReply): Envelope<T> | null {
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

export function totp(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

export function adminClient(local: LocalStack) {
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
    updateUserEmail: async (id: string, email: string) => {
      const response = await fetch(`${local.apiUrl}/auth/v1/admin/users/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ email, email_confirm: true }),
      });
      if (!response.ok) throw new Error('synthetic admin email update failed');
    },
  };
}

// The local cluster's superuser-less admin role can only be reached by literal SQL; all values
// in these probes are single-line synthetic ASCII.
export const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function localAdmin(db = 'postgres') {
  return postgres(`${LOCAL_DB_URL}/${db}`, { prepare: false, max: 1 });
}

export function runtimeClient(password: string, db = 'postgres') {
  return postgres(`postgresql://app_runtime:${password}@127.0.0.1:54322/${db}`, { prepare: false, max: 1 });
}

export const migrationFiles = readdirSync(fileURLToPath(new URL('../../supabase/migrations', import.meta.url)))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)));

// A signed-in, AAL2-verified host: real Admin API invite, real password sign-in, real TOTP step-up.
export type VerifiedHost = { userId: string; email: string; jar: Jar };

export async function verifiedHost(local: LocalStack, label: string): Promise<VerifiedHost> {
  const email = `synthetic-${label}-${Date.now()}@example.test`;
  const userId = await adminClient(local).createUser(email, SYNTHETIC_PASSWORD);
  const jar = memoryJar();
  const client = createServerClient(local.apiUrl, local.anonKey, {
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
  });
  const signIn = await client.auth.signInWithPassword({ email, password: SYNTHETIC_PASSWORD });
  if (signIn.error) throw new Error('synthetic sign-in failed');
  const enrolled = decode<{ factorId: string; secret: string }>(
    await fnCall(HOST_FNS, 'mfaEnroll', { jar, data: {} }),
  )?.result;
  const verified = decode<{ ok?: boolean }>(
    await fnCall(HOST_FNS, 'mfaVerify', {
      jar,
      data: { factorId: enrolled?.factorId, code: totp(enrolled?.secret ?? '') },
    }),
  )?.result;
  if (!verified?.ok) throw new Error('synthetic step-up failed');
  return { userId, email, jar };
}
