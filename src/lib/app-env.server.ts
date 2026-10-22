import { z } from 'zod';

const appEnvSchema = z.enum(['local', 'preview', 'production']);

export type AppEnv = z.infer<typeof appEnvSchema>;

export function parseAppEnv(env: Record<string, string | undefined>): AppEnv {
  const explicit = appEnvSchema.safeParse(env.APP_ENV);
  if (env.APP_ENV !== undefined && !explicit.success) {
    throw new Error('APP_ENV must be one of: local, preview, production');
  }
  if (explicit.success) {
    return explicit.data;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('APP_ENV must be set explicitly when NODE_ENV=production');
  }
  // SITE_ID is a read-only Netlify runtime variable (as for trustNetlifyGeo); a deploy never falls back to local.
  if (env.SITE_ID && !env.NETLIFY_DEV) {
    throw new Error('APP_ENV must be set explicitly on Netlify');
  }
  return 'local';
}
