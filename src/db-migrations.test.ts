import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20261018100000_phase2_auth_database_security.sql', import.meta.url)),
  'utf8',
);
const roles = readFileSync(fileURLToPath(new URL('../supabase/roles.sql', import.meta.url)), 'utf8');

describe('phase 2 role migration', () => {
  it('never carries credentials, so a pre-provisioned password survives every environment', () => {
    expect(migration).not.toMatch(/password/i);
    expect(migration).not.toContain('app_runtime_local');
  });

  it('still creates a login-capable runtime role with the fail-closed attributes', () => {
    expect(migration).toContain('create role app_runtime login nosuperuser nocreatedb nocreaterole nobypassrls');
    expect(migration).toContain('alter role app_runtime login nocreatedb nocreaterole nobypassrls');
  });
});

describe('local roles provisioning', () => {
  it('keeps the synthetic local credential in the CLI-local roles.sql only', () => {
    expect(roles).toContain("password 'app_runtime_local'");
    expect(roles).toMatch(/not exists \(select from pg_roles where rolname = 'app_runtime'\)/);
  });
});
