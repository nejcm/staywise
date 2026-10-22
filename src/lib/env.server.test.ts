import { describe, expect, it } from 'vitest';
import { parseAppEnv, parseServerEnv } from './env.server';

describe('parseAppEnv', () => {
  it('defaults to local outside production', () => {
    expect(parseAppEnv({ NODE_ENV: 'development' })).toBe('local');
  });

  it('requires APP_ENV explicitly in production', () => {
    expect(() => parseAppEnv({ NODE_ENV: 'production' })).toThrow(/APP_ENV/);
  });

  it('accepts an explicit preview environment in production', () => {
    expect(parseAppEnv({ APP_ENV: 'preview', NODE_ENV: 'production' })).toBe('preview');
  });

  it('requires APP_ENV explicitly on a Netlify runtime', () => {
    expect(() => parseAppEnv({ SITE_ID: 'synthetic-site', NODE_ENV: 'development' })).toThrow(/APP_ENV/);
    expect(parseAppEnv({ SITE_ID: 'synthetic-site', APP_ENV: 'preview' })).toBe('preview');
  });

  it('still defaults to local under netlify dev', () => {
    expect(parseAppEnv({ SITE_ID: 'synthetic-site', NETLIFY_DEV: 'true' })).toBe('local');
  });

  it('rejects unknown APP_ENV values', () => {
    expect(() => parseAppEnv({ APP_ENV: 'prod' })).toThrow(/APP_ENV/);
  });
});

function remoteEnv(appDbUrl: string): Record<string, string> {
  return {
    APP_ENV: 'preview',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    SUPABASE_SECRET_KEY: 'sb_secret_synthetic',
    APP_DB_URL: appDbUrl,
    SMTP_URL: 'smtp://mail.example.test:587?requireTLS=true',
    SMTP_FROM: 'hosts@example.test',
    APP_ORIGIN: 'https://app.example.test',
    SHARE_HMAC_KEY: 'synthetic-remote-share-hmac-key-0123456789',
  };
}

describe('parseServerEnv', () => {
  it('fills synthetic local defaults only for APP_ENV=local', () => {
    const env = parseServerEnv({ APP_ENV: 'local' });
    expect(env.supabaseUrl).toBe('http://127.0.0.1:54321');
    expect(env.appDbUrl).toContain('app_runtime');
    expect(env.appDbCaPath).toBeNull();
    expect(env.appOrigin).toBe('http://localhost:3000');
  });

  it('refuses local fallbacks outside APP_ENV=local', () => {
    expect(() => parseServerEnv({ APP_ENV: 'preview' })).toThrow(/SUPABASE_URL/);
    expect(() => parseServerEnv({ APP_ENV: 'production', NODE_ENV: 'production' })).toThrow(/SUPABASE_URL/);
  });

  it('accepts an explicit remote database URL with verify-full TLS and the root CA file', () => {
    const env = parseServerEnv(
      remoteEnv(
        'postgresql://user:pass@db.example.test:5432/postgres?sslmode=verify-full&sslrootcert=/etc/staywise/db-root-ca.pem',
      ),
    );
    expect(env.appEnv).toBe('preview');
    expect(env.appDbCaPath).toBe('/etc/staywise/db-root-ca.pem');
  });

  it('rejects remote database URLs without verify-full TLS', () => {
    for (const appDbUrl of [
      'postgresql://user:pass@db.example.test:5432/postgres',
      'postgresql://user:pass@db.example.test:5432/postgres?sslmode=require',
      'postgresql://user:pass@db.example.test:5432/postgres?sslmode=verify-ca&sslrootcert=/etc/staywise/db-root-ca.pem',
    ]) {
      expect(() => parseServerEnv(remoteEnv(appDbUrl))).toThrow(/sslmode=verify-full/);
    }
  });

  it('rejects remote database URLs without a project root CA file', () => {
    for (const appDbUrl of [
      'postgresql://user:pass@db.example.test:5432/postgres?sslmode=verify-full',
      'postgresql://user:pass@db.example.test:5432/postgres?sslmode=verify-full&sslrootcert=system',
    ]) {
      expect(() => parseServerEnv(remoteEnv(appDbUrl))).toThrow(/sslrootcert/);
    }
  });

  it('requires a long explicit SHARE_HMAC_KEY outside APP_ENV=local', () => {
    const appDbUrl =
      'postgresql://user:pass@db.example.test:5432/postgres?sslmode=verify-full&sslrootcert=/etc/staywise/db-root-ca.pem';
    const explicit = { ...remoteEnv(appDbUrl), SHARE_HMAC_KEY: 'short' };
    expect(() => parseServerEnv(explicit)).toThrow(/SHARE_HMAC_KEY/);
    const missing = { ...remoteEnv(appDbUrl) };
    delete (missing as Record<string, string | undefined>).SHARE_HMAC_KEY;
    expect(() => parseServerEnv(missing)).toThrow(/SHARE_HMAC_KEY/);
    expect(parseServerEnv(remoteEnv(appDbUrl)).shareHmacKey).toBe('synthetic-remote-share-hmac-key-0123456789');
  });

  it('requires mandatory SMTP TLS outside APP_ENV=local', () => {
    const appDbUrl =
      'postgresql://user:pass@db.example.test:5432/postgres?sslmode=verify-full&sslrootcert=/etc/staywise/db-root-ca.pem';
    for (const smtpUrl of ['smtps://user:pass@mail.example.test:465', 'smtp://mail.example.test:587?requireTLS=true']) {
      expect(parseServerEnv({ ...remoteEnv(appDbUrl), SMTP_URL: smtpUrl }).smtpUrl).toBe(smtpUrl);
    }
    for (const smtpUrl of [
      'smtp://mail.example.test:587',
      'smtp://mail.example.test:587?requireTLS=false',
      'smtp://mail.example.test:587?requireTLS=true&requireTLS=false',
      'smtp://mail.example.test:587?requireTLS=true&ignoreTLS=true',
      'smtps://mail.example.test:465?secure=false',
      'smtps://mail.example.test:465?tls.rejectUnauthorized=false',
    ]) {
      expect(() => parseServerEnv({ ...remoteEnv(appDbUrl), SMTP_URL: smtpUrl })).toThrow(/SMTP_URL/);
    }
    expect(parseServerEnv({ APP_ENV: 'local' }).smtpUrl).toBe('smtp://127.0.0.1:54325');
  });

  it('parses the MFA toggle strictly and defaults it off', () => {
    expect(parseServerEnv({ APP_ENV: 'local' }).mfaRequired).toBe(false);
    expect(parseServerEnv({ APP_ENV: 'local', MFA_REQUIRED: 'true' }).mfaRequired).toBe(true);
    expect(parseServerEnv({ APP_ENV: 'local', MFA_REQUIRED: 'false' }).mfaRequired).toBe(false);
    expect(() => parseServerEnv({ APP_ENV: 'local', MFA_REQUIRED: 'no' })).toThrow(/MFA_REQUIRED/);
  });

  it('trusts the Netlify geo header only on a deployed Netlify runtime', () => {
    const appDbUrl =
      'postgresql://user:pass@db.example.test:5432/postgres?sslmode=verify-full&sslrootcert=/etc/staywise/db-root-ca.pem';
    expect(parseServerEnv({ ...remoteEnv(appDbUrl), SITE_ID: 'synthetic-site' }).trustNetlifyGeo).toBe(true);
    expect(parseServerEnv(remoteEnv(appDbUrl)).trustNetlifyGeo).toBe(false);
    expect(
      parseServerEnv({ ...remoteEnv(appDbUrl), SITE_ID: 'synthetic-site', NETLIFY_DEV: 'true' }).trustNetlifyGeo,
    ).toBe(false);
    expect(parseServerEnv({ APP_ENV: 'local', SITE_ID: 'synthetic-site' }).trustNetlifyGeo).toBe(false);
  });

  it('accepts only an sb_secret_ Supabase secret key and leaves it unset by default', () => {
    expect(parseServerEnv({ APP_ENV: 'local' }).supabaseSecretKey).toBeNull();
    expect(parseServerEnv({ APP_ENV: 'local', SUPABASE_SECRET_KEY: 'sb_secret_synthetic' }).supabaseSecretKey).toBe(
      'sb_secret_synthetic',
    );
    expect(() => parseServerEnv({ APP_ENV: 'local', SUPABASE_SECRET_KEY: 'eyJ.service.role' })).toThrow(
      /SUPABASE_SECRET_KEY/,
    );
  });

  it('requires the Supabase secret key outside local', () => {
    const { SUPABASE_SECRET_KEY: _omitted, ...env } = remoteEnv(
      'postgresql://user:pass@db.example.test:5432/postgres?sslmode=verify-full&sslrootcert=/etc/staywise/db-root-ca.pem',
    );
    expect(() => parseServerEnv(env)).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('parses the guest kill switch strictly and defaults it off', () => {
    expect(parseServerEnv({ APP_ENV: 'local' }).guestAccessDisabled).toBe(false);
    expect(parseServerEnv({ APP_ENV: 'local', GUEST_ACCESS_DISABLED: 'false' }).guestAccessDisabled).toBe(false);
    expect(parseServerEnv({ APP_ENV: 'local', GUEST_ACCESS_DISABLED: 'true' }).guestAccessDisabled).toBe(true);
    expect(() => parseServerEnv({ APP_ENV: 'local', GUEST_ACCESS_DISABLED: 'yes' })).toThrow(/GUEST_ACCESS_DISABLED/);
  });

  it('keeps agent access off outside local unless explicitly enabled', () => {
    const remote = remoteEnv(
      'postgresql://app_runtime:x@db.example.test:5432/postgres?sslmode=verify-full&sslrootcert=/ca.pem',
    );
    expect(parseServerEnv({ APP_ENV: 'local' }).agentAccessDisabled).toBe(false);
    expect(parseServerEnv(remote).agentAccessDisabled).toBe(true);
    expect(parseServerEnv({ ...remote, AGENT_ACCESS_DISABLED: 'false' }).agentAccessDisabled).toBe(false);
    expect(parseServerEnv({ APP_ENV: 'local', AGENT_ACCESS_DISABLED: 'true' }).agentAccessDisabled).toBe(true);
    expect(() => parseServerEnv({ APP_ENV: 'local', AGENT_ACCESS_DISABLED: '1' })).toThrow(/AGENT_ACCESS_DISABLED/);
  });
});

describe('PostHog error reporting env', () => {
  const key = 'phc_synthetic';
  const host = 'https://eu.i.posthog.com';

  it('is off unless configured', () => {
    expect(parseServerEnv({ APP_ENV: 'local' }).posthog).toBeNull();
  });

  it('needs the key and an https host together', () => {
    expect(
      parseServerEnv({ APP_ENV: 'local', VITE_POSTHOG_PROJECT_TOKEN: key, VITE_POSTHOG_HOST: `${host}/` }).posthog,
    ).toEqual({
      apiKey: key,
      host,
    });
    expect(() => parseServerEnv({ APP_ENV: 'local', VITE_POSTHOG_PROJECT_TOKEN: key })).toThrow(/POSTHOG/);
    expect(() => parseServerEnv({ APP_ENV: 'local', VITE_POSTHOG_HOST: host })).toThrow(/POSTHOG/);
    expect(() =>
      parseServerEnv({ APP_ENV: 'local', VITE_POSTHOG_PROJECT_TOKEN: key, VITE_POSTHOG_HOST: 'http://x.test' }),
    ).toThrow(/POSTHOG/);
    expect(() =>
      parseServerEnv({ APP_ENV: 'local', VITE_POSTHOG_PROJECT_TOKEN: 'bad', VITE_POSTHOG_HOST: host }),
    ).toThrow(/POSTHOG/);
  });
});

describe('SUPPORT_EMAIL env', () => {
  it('is off unless configured and must be an email', () => {
    expect(parseServerEnv({ APP_ENV: 'local' }).supportEmail).toBeNull();
    expect(parseServerEnv({ APP_ENV: 'local', SUPPORT_EMAIL: ' help@example.test ' }).supportEmail).toBe(
      'help@example.test',
    );
    expect(() => parseServerEnv({ APP_ENV: 'local', SUPPORT_EMAIL: 'nope' })).toThrow(/SUPPORT_EMAIL/);
  });
});
