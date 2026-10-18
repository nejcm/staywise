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

  it('rejects unknown APP_ENV values', () => {
    expect(() => parseAppEnv({ APP_ENV: 'prod' })).toThrow(/APP_ENV/);
  });
});

function remoteEnv(appDbUrl: string): Record<string, string> {
  return {
    APP_ENV: 'preview',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    APP_DB_URL: appDbUrl,
    SMTP_URL: 'smtp://mail.example.test:587',
    SMTP_FROM: 'hosts@example.test',
    APP_ORIGIN: 'https://app.example.test',
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
});
