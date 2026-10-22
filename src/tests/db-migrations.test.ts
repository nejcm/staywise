import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/20261018000000_initial_schema.sql', import.meta.url)),
  'utf8',
);
const roles = readFileSync(fileURLToPath(new URL('../../supabase/roles.sql', import.meta.url)), 'utf8');

describe('initial schema role migration', () => {
  it('never carries credentials, so a pre-provisioned password survives every environment', () => {
    expect(migration).not.toMatch(/\bpassword\b/i);
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

describe('migration functions', () => {
  const directory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
  const headers = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .flatMap((name) =>
      [
        ...readFileSync(`${directory}${name}`, 'utf8').matchAll(
          /create (?:or replace )?function ([\w.]+)[\s\S]*?\bas \$\$/gi,
        ),
      ].map((match) => ({ name: `${name}: ${match[1]}`, header: match[0] })),
    );

  it('pins an empty search path on every security definer function', () => {
    const definers = headers.filter(({ header }) => /security definer/i.test(header));
    expect(definers.map(({ name }) => name)).toContain(
      '20261027090000_guest_policy_hardening.sql: app.current_link_live',
    );
    expect(definers.filter(({ header }) => !header.includes("set search_path = ''")).map(({ name }) => name)).toEqual(
      [],
    );
  });
});
