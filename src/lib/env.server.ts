import { z } from 'zod';
import { parseAppEnv, type AppEnv } from './app-env.server';

export { parseAppEnv };
export type { AppEnv };

const supabaseUrlSchema = z.url().refine((value) => value.startsWith('http'), {
  message: 'SUPABASE_URL must be an http(s) URL',
});
const postgresUrlSchema = z
  .url()
  .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
    message: 'APP_DB_URL must be a postgres:// URL',
  });

// Local defaults are the synthetic local Supabase stack; production requires every value explicitly.
const localDefaults: Record<string, string> = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  APP_DB_URL: 'postgresql://app_runtime:app_runtime_local@127.0.0.1:54322/postgres',
  SMTP_URL: 'smtp://127.0.0.1:54325',
  APP_ORIGIN: 'http://localhost:3000',
  SMTP_FROM: 'staywise@example.test',
  SHARE_HMAC_KEY: 'staywise-local-synthetic-share-hmac-key',
};

export type GoogleTranslateCredentials = { clientEmail: string; privateKey: string; projectId: string };

export type ServerEnv = {
  appEnv: AppEnv;
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string | null;
  appDbUrl: string;
  appDbCaPath: string | null;
  smtpUrl: string;
  smtpFrom: string;
  appOrigin: string;
  shareHmacKey: string;
  guestAccessDisabled: boolean;
  mfaRequired: boolean;
  // Absent means translation egress is not configured; a malformed value fails closed at boot.
  googleTranslateServiceAccount: GoogleTranslateCredentials | null;
};

// Outside APP_ENV=local the connection must declare verify-full TLS against the project root CA;
// db.server.ts turns the CA path into the driver's explicit ssl options.
function parseDbCaPath(appDbUrl: string, appEnv: AppEnv): string | null {
  if (appEnv === 'local') return null;
  const params = new URL(appDbUrl).searchParams;
  if (params.get('sslmode') !== 'verify-full') {
    throw new Error('APP_DB_URL must set sslmode=verify-full when APP_ENV is not local');
  }
  const caPath = params.get('sslrootcert');
  if (!caPath || caPath === 'system') {
    throw new Error('APP_DB_URL must set sslrootcert to the project root CA file');
  }
  return caPath;
}

// Outside APP_ENV=local mail must never fall back to plaintext: implicit TLS (smtps://) or
// mandatory STARTTLS (requireTLS=true), with no URL option that weakens either.
const weakeningSmtpOptions = ['ignoreTLS', 'opportunisticTLS', 'secure', 'tls.rejectUnauthorized'];

function parseSmtpUrl(smtpUrl: string, appEnv: AppEnv): string {
  if (appEnv === 'local') return smtpUrl;
  const url = new URL(smtpUrl);
  const params = url.searchParams;
  const weakened = weakeningSmtpOptions.some((key) => params.has(key));
  const requiresTls =
    url.protocol === 'smtps:' ||
    (url.protocol === 'smtp:' && params.getAll('requireTLS').length === 1 && params.get('requireTLS') === 'true');
  if (weakened || !requiresTls) {
    throw new Error('SMTP_URL must use smtps:// or smtp://...?requireTLS=true when APP_ENV is not local');
  }
  return smtpUrl;
}

function parseValue(
  env: Record<string, string | undefined>,
  name: string,
  appEnv: AppEnv,
  schema: z.ZodType<string>,
): string {
  const raw = env[name] ?? (appEnv === 'local' ? localDefaults[name] : undefined);
  if (raw === undefined) {
    throw new Error(`${name} must be set explicitly when APP_ENV is not local`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${name} is invalid`);
  }
  return parsed.data;
}

export function parseServerEnv(env: Record<string, string | undefined>): ServerEnv {
  const appEnv = parseAppEnv(env);
  const supabaseUrl = parseValue(env, 'SUPABASE_URL', appEnv, supabaseUrlSchema);
  const supabasePublishableKey = parseValue(env, 'SUPABASE_PUBLISHABLE_KEY', appEnv, z.string().min(1));
  const appDbUrl = parseValue(env, 'APP_DB_URL', appEnv, postgresUrlSchema);
  return {
    appEnv,
    supabaseUrl,
    supabasePublishableKey,
    supabaseSecretKey: parseSupabaseSecretKey(env.SUPABASE_SECRET_KEY),
    appDbUrl,
    appDbCaPath: parseDbCaPath(appDbUrl, appEnv),
    smtpUrl: parseSmtpUrl(parseValue(env, 'SMTP_URL', appEnv, z.url()), appEnv),
    smtpFrom: parseValue(env, 'SMTP_FROM', appEnv, z.email()),
    appOrigin: parseValue(env, 'APP_ORIGIN', appEnv, z.url()),
    // Key for share-secret digests and guest rate-limit fingerprints; never leaves the server.
    shareHmacKey: parseValue(env, 'SHARE_HMAC_KEY', appEnv, z.string().min(32)),
    guestAccessDisabled: parseGuestAccessDisabled(env.GUEST_ACCESS_DISABLED),
    mfaRequired: parseMfaRequired(env.MFA_REQUIRED),
    googleTranslateServiceAccount: parseGoogleTranslateServiceAccount(env.GOOGLE_TRANSLATE_SERVICE_ACCOUNT),
  };
}

// Operator kill switch: a deliberate value is required, and a typo must stop the boot rather than
// leave guest access silently enabled.
function parseGuestAccessDisabled(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error('GUEST_ACCESS_DISABLED must be true or false');
}

// Optional: only the magic-link request uses it, so Auth can trust Sb-Forwarded-For.
function parseSupabaseSecretKey(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  if (!raw.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_ key');
  return raw;
}

function parseMfaRequired(raw: string | undefined): boolean {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error('MFA_REQUIRED must be true or false');
}

// Translation egress stays off until the documented provider gate is passed and the service
// account is injected; anything malformed throws instead of silently disabling the feature.
function parseGoogleTranslateServiceAccount(raw: string | undefined): GoogleTranslateCredentials | null {
  if (raw === undefined || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_TRANSLATE_SERVICE_ACCOUNT must be service account JSON');
  }
  const account = z
    .object({ client_email: z.email(), private_key: z.string().min(1), project_id: z.string().min(1) })
    .safeParse(parsed);
  if (!account.success) {
    throw new Error('GOOGLE_TRANSLATE_SERVICE_ACCOUNT is missing client_email, private_key, or project_id');
  }
  return {
    clientEmail: account.data.client_email,
    privateKey: account.data.private_key,
    projectId: account.data.project_id,
  };
}

export const serverEnv: ServerEnv = parseServerEnv(process.env);
export const appEnv: AppEnv = serverEnv.appEnv;
