// Phase 7a restore regression: a real logical dump of a scratch source database (all migrations plus
// synthetic guide, ownership, translation, session, and expired-retention rows) is restored into a
// second scratch database. The restored copy must carry the same rows, enforced RLS and grants, no
// post-dump rows, and the overdue cleanup must run there before guide data is read. No live database
// is touched and both scratch databases are dropped at the end.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectLocalDb, localAdmin, migrationFiles } from './integration-helpers';

const BOUNDARY = '2026-10-19T12:00:00Z';
const USER_A = '7b7b0000-0000-4000-8000-0000000000a1';
const USER_B = '7b7b0000-0000-4000-8000-0000000000b1';
const PROPERTY_A = '7b7b0000-0000-4000-8000-0000000000a2';
const PROPERTY_B = '7b7b0000-0000-4000-8000-0000000000b2';

const SEED = `
insert into auth.users (id, email) values
  ('${USER_A}', 'restore-a@example.test'),
  ('${USER_B}', 'restore-b@example.test');
insert into app.properties (id, owner_id, display_name, published, enabled_locales) values
  ('${PROPERTY_A}', '${USER_A}', 'Restore A', true, '{de}'),
  ('${PROPERTY_B}', '${USER_B}', 'Restore B', true, '{}');
insert into app.property_credentials (property_id, wifi_name, keybox_code) values
  ('${PROPERTY_A}', 'Restore net', '4321');
insert into app.guide_sections (id, property_id, category, title, body, published) values
  ('7b7b0000-0000-4000-8000-0000000000a4', '${PROPERTY_A}', 'wifi', 'Wi-Fi', 'Password is on the router', true),
  ('7b7b0000-0000-4000-8000-0000000000b4', '${PROPERTY_B}', 'parking', 'Parking', 'Behind the gate', true);
insert into app.guide_translations (id, section_id, locale, title, body, source_revision, state, provider) values
  ('7b7b0000-0000-4000-8000-0000000000a5', '7b7b0000-0000-4000-8000-0000000000a4', 'de', 'WLAN', 'Passwort steht am Router', 1, 'approved', 'google-translate-v3');
insert into app.share_links (id, secret_hmac, property_id, created_at) values
  ('restoreLinkA000000001', '\\x0102', '${PROPERTY_A}', '2026-10-01T00:00:00Z'),
  ('restoreLinkB000000001', '\\x0102', '${PROPERTY_B}', '2026-10-01T00:00:00Z');
insert into app.share_links (id, secret_hmac, property_id, enabled, disabled_at) values
  ('restoreLinkOld0000001', null, '${PROPERTY_A}', false, '2026-09-18T12:00:00Z');
insert into app.guest_sessions (id, session_hash, share_link_id, expires_at) values
  ('7b7b0000-0000-4000-8000-0000000000a6', '\\x11', 'restoreLinkA000000001', '2026-10-20T00:00:00Z'),
  ('7b7b0000-0000-4000-8000-0000000000b6', '\\x13', 'restoreLinkB000000001', '2026-10-19T11:59:59Z');
insert into app.guest_messages (id, property_id, kind, category, body, created_at) values
  ('7b7b0000-0000-4000-8000-0000000000a9', '${PROPERTY_A}', 'question', 'wifi', 'Expired A body', '2026-07-20T12:00:00Z'),
  ('7b7b0000-0000-4000-8000-0000000000aa', '${PROPERTY_A}', 'question', 'wifi', 'Body marker stays verbatim', '2026-10-18T12:00:00Z'),
  ('7b7b0000-0000-4000-8000-0000000000b9', '${PROPERTY_B}', 'issue', null, 'Expired B body', '2026-07-01T12:00:00Z'),
  ('7b7b0000-0000-4000-8000-0000000000ba', '${PROPERTY_B}', 'question', 'wifi', 'Fresh B body', '2026-10-19T11:00:00Z');
insert into app.audit_events (actor_id, action, created_at) values
  ('${USER_A}', 'sign_in', '2026-07-20T12:00:00Z'),
  ('${USER_A}', 'sign_in', '2026-10-18T12:00:00Z');
insert into app.setup_events (owner_id, event_type, property_id, created_at) values
  ('${USER_A}', 'property_created', '${PROPERTY_A}', '2026-07-20T12:00:00Z'),
  ('${USER_A}', 'section_saved', '${PROPERTY_A}', '2026-10-18T12:00:00Z');
insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end) values
  ('7b7b0000-0000-4000-8000-0000000000ad', '${PROPERTY_A}', 'restore', 'restore-expired', '2026-07-10', '2026-07-16'),
  ('7b7b0000-0000-4000-8000-0000000000ae', '${PROPERTY_A}', 'restore', 'restore-fresh', '2026-10-01', '2026-10-09');
insert into app.rate_limits (property_id, key_hash, window_start, count) values
  ('${PROPERTY_A}', '\\x21', '2026-10-18T00:00:00Z', 4),
  ('${PROPERTY_A}', '\\x22', '2026-10-19T00:00:00Z', 2);
insert into app.guest_counters (property_id, day, link_exchanges, guide_opens, submissions) values
  ('${PROPERTY_A}', '2026-10-19', 3, 4, 2);
`;

const COUNT_SQL = `
select
  (select count(*)::integer from app.properties) as properties,
  (select count(*)::integer from app.guide_sections) as sections,
  (select count(*)::integer from app.guide_translations) as translations,
  (select count(*)::integer from app.share_links) as links,
  (select count(*)::integer from app.guest_sessions) as sessions,
  (select count(*)::integer from app.guest_messages) as messages,
  (select count(*)::integer from app.audit_events) as audit_events,
  (select count(*)::integer from app.setup_events) as setup_events,
  (select count(*)::integer from app.reservations) as reservations,
  (select count(*)::integer from app.guest_counters) as counters,
  (select count(*)::integer from app.property_credentials) as credentials
`;

type Counts = Record<
  | 'properties'
  | 'sections'
  | 'translations'
  | 'links'
  | 'sessions'
  | 'messages'
  | 'audit_events'
  | 'setup_events'
  | 'reservations'
  | 'counters'
  | 'credentials',
  number
>;

function backupTools(): boolean {
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' });
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function psqlInput(db: string, input: string) {
  execFileSync('psql', ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], {
    input,
    env: { ...process.env, PGPASSWORD: 'postgres' },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const dbUp = await detectLocalDb();
const describeLocal = dbUp && backupTools() ? describe : describe.skip;

describeLocal('phase 7a restore rehearsal (scratch databases)', () => {
  it('restores a real dump with ownership, guide content, approved translation, revoked sessions, RLS and overdue cleanup', async () => {
    const sourceName = `staywise_restore_src_${Date.now()}`;
    const restoreName = `staywise_restore_dst_${Date.now()}`;
    const admin = localAdmin();
    let sourceCreated = false;
    let restoreCreated = false;
    try {
      await admin.unsafe(`create database ${sourceName}`);
      sourceCreated = true;
      const source = localAdmin(sourceName);
      let dump: string;
      let snapshot: Counts;
      try {
        await source.unsafe('create schema auth; create table auth.users (id uuid primary key, email text);');
        for (const migration of migrationFiles) await source.unsafe(readFileSync(migration, 'utf8'));
        await source.unsafe(SEED);
        [snapshot] = await source.unsafe<Counts[]>(COUNT_SQL);
        const [sourcePolicies] = await source<{ n: number }[]>`
          select count(*)::integer as n from pg_policies where schemaname = 'app'`;
        dump = execFileSync(
          'pg_dump',
          ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', sourceName, '--schema=app', '--schema=auth'],
          {
            env: { ...process.env, PGPASSWORD: 'postgres' },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 32 * 1024 * 1024,
          },
        );
        // A row written after the dump must never appear in the restored copy.
        await source`insert into app.guest_messages (property_id, kind, body)
          values (${PROPERTY_A}, 'question', 'post-dump marker')`;
        expect(dump).toContain('CREATE POLICY guest_messages_retention_delete');
        expect(dump).toContain('FORCE ROW LEVEL SECURITY');
        expect(dump).toContain('FUNCTION app.retention_cleanup');

        await admin.unsafe(`create database ${restoreName}`);
        restoreCreated = true;
        psqlInput(restoreName, dump);
        const restored = localAdmin(restoreName);
        try {
          expect(await restored.unsafe<Counts[]>(COUNT_SQL)).toEqual([snapshot!]);
          const [restoredPolicies] = await restored<{ n: number }[]>`
            select count(*)::integer as n from pg_policies where schemaname = 'app'`;
          expect(restoredPolicies).toEqual(sourcePolicies);

          expect(
            await restored`select p.display_name, u.email from app.properties p
              join auth.users u on u.id = p.owner_id order by p.display_name`,
          ).toEqual([
            { display_name: 'Restore A', email: 'restore-a@example.test' },
            { display_name: 'Restore B', email: 'restore-b@example.test' },
          ]);
          expect(
            await restored<{ title: string; body: string; state: string; provider: string }[]>`
              select s.title, s.body, t.state, t.provider
              from app.guide_sections s join app.guide_translations t on t.section_id = s.id
              where s.id = '7b7b0000-0000-4000-8000-0000000000a4'`,
          ).toEqual([
            { title: 'Wi-Fi', body: 'Password is on the router', state: 'approved', provider: 'google-translate-v3' },
          ]);
          expect(
            await restored<
              { body: string }[]
            >`select body from app.guest_messages where id = '7b7b0000-0000-4000-8000-0000000000aa'`,
          ).toEqual([{ body: 'Body marker stays verbatim' }]);
          expect(
            await restored<{ body: string }[]>`select body from app.guest_messages where body = 'post-dump marker'`,
          ).toEqual([]);
          expect(
            await restored`select id, secret_hmac::text as digest from app.share_links where id = 'restoreLinkOld0000001'`,
          ).toEqual([{ id: 'restoreLinkOld0000001', digest: null }]);
          expect(
            await restored<{ hash: string }[]>`select session_hash::text as hash from app.guest_sessions
              where share_link_id = 'restoreLinkA000000001'`,
          ).toEqual([{ hash: '\\x11' }]);

          const [rls] = await restored<{ n: number }[]>`
            select count(*)::integer as n from pg_class
            where relnamespace = 'app'::regnamespace and relkind = 'r'
              and relrowsecurity and relforcerowsecurity`;
          expect(rls).toEqual({ n: 14 });
          expect(
            await restored<{ n: number }[]>`
              select count(*)::integer as n from pg_policies where schemaname = 'app' and policyname like '%\\_retention\\_%'`,
          ).toEqual([{ n: 14 }]);
          expect(
            await restored<
              { ok: boolean }[]
            >`select has_table_privilege('app_runtime', 'app.properties', 'select') as ok`,
          ).toEqual([{ ok: true }]);
          expect(
            await restored<{ ok: boolean }[]>`
              select has_function_privilege('app_runtime', 'app.retention_cleanup(timestamptz)', 'execute') as ok`,
          ).toEqual([{ ok: false }]);
          // Membership is granted inside the probe transaction, so the rollback leaves cluster roles untouched.
          await restored.unsafe('begin');
          let runtimeRead: { own: number; foreign: number };
          try {
            await restored.unsafe('grant app_runtime to current_user with set true; set local role app_runtime');
            await restored`select set_config('app.owner_id', ${USER_A}, true)`;
            const own = await restored<{ n: number }[]>`select count(*)::integer as n from app.properties`;
            const foreign = await restored<
              { n: number }[]
            >`select count(*)::integer as n from app.properties where owner_id = ${USER_B}`;
            runtimeRead = { own: own[0]!.n, foreign: foreign[0]!.n };
          } finally {
            await restored.unsafe('reset role; rollback');
          }
          expect(runtimeRead).toEqual({ own: 1, foreign: 0 });

          // Overdue cleanup runs before the restored guide is treated as serving traffic.
          const [first] = await restored<{ result: Record<string, number | string> }[]>`
            select app.retention_cleanup(${BOUNDARY}::timestamptz) as result`;
          expect(first!.result).toMatchObject({
            guest_messages: 2,
            audit_events: 1,
            setup_events: 1,
            reservations: 1,
            share_links: 1,
            guest_sessions: 1,
            rate_limits: 1,
          });
          const [second] = await restored<{ result: Record<string, number | string> }[]>`
            select app.retention_cleanup(${BOUNDARY}::timestamptz) as result`;
          expect(second!.result).toMatchObject({
            guest_messages: 0,
            audit_events: 0,
            setup_events: 0,
            reservations: 0,
            share_links: 0,
            guest_sessions: 0,
            rate_limits: 0,
          });
          expect(await restored.unsafe<Counts[]>(COUNT_SQL)).toEqual([
            {
              properties: 2,
              sections: 2,
              translations: 1,
              links: 2,
              sessions: 1,
              messages: 2,
              audit_events: 1,
              setup_events: 1,
              reservations: 1,
              counters: 1,
              credentials: 1,
            },
          ]);
          expect(await restored<{ body: string }[]>`select body from app.guest_messages order by body`).toEqual([
            { body: 'Body marker stays verbatim' },
            { body: 'Fresh B body' },
          ]);
          expect(await restored<{ provider: string }[]>`select provider from app.guide_translations`).toEqual([
            { provider: 'google-translate-v3' },
          ]);
        } finally {
          await restored.end({ timeout: 0 });
        }
      } finally {
        await source.end({ timeout: 0 });
      }
    } finally {
      if (restoreCreated) await admin.unsafe(`drop database if exists ${restoreName} with (force)`);
      if (sourceCreated) await admin.unsafe(`drop database if exists ${sourceName} with (force)`);
      await admin.end({ timeout: 0 });
    }
  }, 60_000);
});
