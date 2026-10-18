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
};

export type ServerEnv = {
  appEnv: AppEnv;
  supabaseUrl: string;
  supabasePublishableKey: string;
  appDbUrl: string;
  appDbCaPath: string | null;
  smtpUrl: string;
  smtpFrom: string;
  appOrigin: string;
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
    appDbUrl,
    appDbCaPath: parseDbCaPath(appDbUrl, appEnv),
    smtpUrl: parseValue(env, 'SMTP_URL', appEnv, z.url()),
    smtpFrom: parseValue(env, 'SMTP_FROM', appEnv, z.email()),
    appOrigin: parseValue(env, 'APP_ORIGIN', appEnv, z.url()),
  };
}

export const serverEnv: ServerEnv = parseServerEnv(process.env);
export const appEnv: AppEnv = serverEnv.appEnv;
