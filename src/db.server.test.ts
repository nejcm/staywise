import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dbClientOptions, dbDriverUrl } from './db.server';
import type { ServerEnv } from './env.server';

const caPath = fileURLToPath(new URL('./test-fixtures/synthetic-root-ca.pem', import.meta.url));

const localEnv: ServerEnv = {
  appEnv: 'local',
  supabaseUrl: 'http://127.0.0.1:54321',
  supabasePublishableKey: 'synthetic',
  appDbUrl: 'postgresql://app_runtime:app_runtime_local@127.0.0.1:54322/postgres',
  appDbCaPath: null,
  smtpUrl: 'smtp://127.0.0.1:54325',
  smtpFrom: 'staywise@example.test',
  appOrigin: 'http://localhost:3000',
};

describe('dbClientOptions', () => {
  it('keeps the local stack plaintext and transaction-pooler compatible', () => {
    expect(dbClientOptions(localEnv)).toEqual({ prepare: false, max: 5, ssl: false });
  });

  it('verifies the full chain against the project root CA outside local', () => {
    const options = dbClientOptions({ ...localEnv, appEnv: 'production', appDbCaPath: caPath });
    expect(options.ssl).toEqual({ ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true });
  });

  it('fails closed when the root CA file is missing', () => {
    expect(() =>
      dbClientOptions({ ...localEnv, appEnv: 'production', appDbCaPath: '/nonexistent/db-root-ca.pem' }),
    ).toThrow();
    expect(() => dbClientOptions({ ...localEnv, appEnv: 'production', appDbCaPath: null })).toThrow(/root CA/);
  });
});

describe('dbDriverUrl', () => {
  it('strips TLS parameters so the explicit ssl options stay authoritative', () => {
    expect(
      dbDriverUrl(
        'postgresql://app_runtime:secret@db.example.test:5432/postgres?sslmode=verify-full&sslrootcert=/etc/staywise/ca.pem&application_name=staywise',
      ),
    ).toBe('postgresql://app_runtime:secret@db.example.test:5432/postgres?application_name=staywise');
  });
});
