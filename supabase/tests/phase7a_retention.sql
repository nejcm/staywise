-- Phase 7a retention cleanup: boundary semantics, idempotency, cross-property behaviour, the
-- scheduled job, least privilege, and property-deletion cascades including translation provider
-- metadata. Fixtures are synthetic and the whole file rolls back.
begin;

create extension if not exists pgtap;

select plan(47);

do $$ begin execute format('grant app_migrator to %I with set true', current_user); end $$;

-- Two hosts and four properties: A (retention fixtures), A's second property and B (cross-property
-- safety), and C (property-deletion cascade).
insert into auth.users (id, email) values
  ('7a7a0000-0000-4000-8000-0000000000a1', 'pgtap-7a-a@example.test'),
  ('7a7a0000-0000-4000-8000-0000000000b1', 'pgtap-7a-b@example.test');
insert into app.properties (id, owner_id, display_name, published, enabled_locales) values
  ('7a7a0000-0000-4000-8000-0000000000a2', '7a7a0000-0000-4000-8000-0000000000a1', 'Retention A', true, '{de}'),
  ('7a7a0000-0000-4000-8000-0000000000a3', '7a7a0000-0000-4000-8000-0000000000a1', 'Retention A second', true, '{}'),
  ('7a7a0000-0000-4000-8000-0000000000b2', '7a7a0000-0000-4000-8000-0000000000b1', 'Retention B', true, '{}'),
  ('7a7a0000-0000-4000-8000-0000000000c2', '7a7a0000-0000-4000-8000-0000000000a1', 'Cascade C', false, '{}');
insert into app.guide_sections (id, property_id, category, title, body, published) values
  ('7a7a0000-0000-4000-8000-0000000000a4', '7a7a0000-0000-4000-8000-0000000000a2', 'wifi', 'Wi-Fi', 'Password is on the router', true),
  ('7a7a0000-0000-4000-8000-0000000000c4', '7a7a0000-0000-4000-8000-0000000000c2', 'wifi', 'Cascade', 'Cascade body', true);
insert into app.guide_translations (id, section_id, locale, title, body, source_revision, state, provider) values
  ('7a7a0000-0000-4000-8000-0000000000a5', '7a7a0000-0000-4000-8000-0000000000a4', 'de', 'WLAN', 'Passwort steht am Router', 1, 'approved', 'google-translate-v3'),
  ('7a7a0000-0000-4000-8000-0000000000c5', '7a7a0000-0000-4000-8000-0000000000c4', 'de', 'Kaskade', 'Kaskadentext', 1, 'approved', 'google-translate-v3');

-- Boundary 2026-10-19 12:00 UTC: 90-day event cutoff 2026-07-21 12:00, stay cutoff date
-- 2026-07-21, 30-day metadata cutoff 2026-09-19 12:00, rate day start 2026-10-19 00:00.
insert into app.share_links (id, secret_hmac, property_id, created_at) values
  ('pgtap7aLinkA0000001', '\x0102', '7a7a0000-0000-4000-8000-0000000000a2', '2025-08-01T00:00:00Z'),
  ('pgtap7aLinkB0000001', '\x0102', '7a7a0000-0000-4000-8000-0000000000b2', '2026-10-01T00:00:00Z'),
  ('pgtap7aLinkC0000001', '\x0102', '7a7a0000-0000-4000-8000-0000000000c2', '2026-10-01T00:00:00Z');
insert into app.share_links (id, secret_hmac, property_id, enabled, disabled_at) values
  ('pgtap7aLinkA0000002', null, '7a7a0000-0000-4000-8000-0000000000a2', false, '2026-09-18T12:00:00Z'),
  ('pgtap7aLinkA0000003', null, '7a7a0000-0000-4000-8000-0000000000a2', false, '2026-09-20T12:00:00Z');
insert into app.guest_sessions (id, session_hash, share_link_id, expires_at) values
  ('7a7a0000-0000-4000-8000-0000000000a6', '\x11', 'pgtap7aLinkA0000002', '2026-10-19T13:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000a7', '\x12', 'pgtap7aLinkA0000001', '2026-10-19T12:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000a8', '\x13', 'pgtap7aLinkA0000001', '2026-10-19T12:00:01Z'),
  ('7a7a0000-0000-4000-8000-0000000000b6', '\x14', 'pgtap7aLinkB0000001', '2026-10-19T12:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000c6', '\x15', 'pgtap7aLinkC0000001', '2026-10-20T12:00:00Z');
insert into app.guest_messages (id, property_id, kind, category, body, created_at) values
  ('7a7a0000-0000-4000-8000-0000000000a9', '7a7a0000-0000-4000-8000-0000000000a2', 'question', 'wifi', 'expired A', '2026-07-20T12:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000aa', '7a7a0000-0000-4000-8000-0000000000a2', 'question', 'wifi', 'boundary A', '2026-07-21T12:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000ab', '7a7a0000-0000-4000-8000-0000000000a2', 'question', 'wifi', 'fresh A', '2026-10-19T06:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000ac', '7a7a0000-0000-4000-8000-0000000000a3', 'issue', null, 'fresh A second', '2026-10-19T06:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000b9', '7a7a0000-0000-4000-8000-0000000000b2', 'question', 'wifi', 'expired B', '2026-07-20T12:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000c9', '7a7a0000-0000-4000-8000-0000000000c2', 'question', 'wifi', 'cascade message', '2026-10-19T06:00:00Z');
insert into app.audit_events (actor_id, action, created_at) values
  ('7a7a0000-0000-4000-8000-0000000000a1', 'sign_in', '2026-07-20T12:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000a1', 'sign_in', '2026-07-21T12:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000a1', 'sign_in', '2026-10-19T06:00:00Z');
insert into app.setup_events (owner_id, event_type, property_id, step, created_at) values
  ('7a7a0000-0000-4000-8000-0000000000a1', 'section_saved', '7a7a0000-0000-4000-8000-0000000000a2', 'wifi', '2026-07-20T12:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000a1', 'section_saved', '7a7a0000-0000-4000-8000-0000000000a2', 'wifi', '2026-10-19T06:00:00Z'),
  ('7a7a0000-0000-4000-8000-0000000000a1', 'section_saved', '7a7a0000-0000-4000-8000-0000000000c2', 'wifi', '2026-10-19T06:00:00Z');
insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end) values
  ('7a7a0000-0000-4000-8000-0000000000ad', '7a7a0000-0000-4000-8000-0000000000a2', 'pgtap', 'rent-expired', '2026-07-15', '2026-07-20'),
  ('7a7a0000-0000-4000-8000-0000000000ae', '7a7a0000-0000-4000-8000-0000000000a2', 'pgtap', 'rent-boundary', '2026-07-18', '2026-07-21'),
  ('7a7a0000-0000-4000-8000-0000000000be', '7a7a0000-0000-4000-8000-0000000000b2', 'pgtap', 'rent-b-expired', '2026-07-14', '2026-07-19'),
  ('7a7a0000-0000-4000-8000-0000000000ce', '7a7a0000-0000-4000-8000-0000000000c2', 'pgtap', 'rent-c', '2026-10-01', '2026-10-05');
insert into app.rate_limits (property_id, key_hash, window_start, count) values
  ('7a7a0000-0000-4000-8000-0000000000a2', '\x21', '2026-10-18T00:00:00Z', 5),
  ('7a7a0000-0000-4000-8000-0000000000a2', '\x22', '2026-10-19T00:00:00Z', 3),
  ('7a7a0000-0000-4000-8000-0000000000c2', '\x23', '2026-10-19T00:00:00Z', 1);
insert into app.guest_counters (property_id, day, link_exchanges, guide_opens, submissions) values
  ('7a7a0000-0000-4000-8000-0000000000a2', '2026-10-19', 4, 5, 3),
  ('7a7a0000-0000-4000-8000-0000000000a2', '2025-09-13', 1, 1, 0),
  ('7a7a0000-0000-4000-8000-0000000000a2', '2025-09-14', 1, 2, 0),
  ('7a7a0000-0000-4000-8000-0000000000c2', '2026-10-19', 1, 1, 1);

-- The function is a security-definer boundary with an empty search path, and only privileged
-- roles can call it: the runtime role cannot purge across tenants.
select ok((select prosecdef from pg_proc where oid = 'app.retention_cleanup(timestamptz)'::regprocedure), 'the cleanup function is security definer');
select ok((select proconfig = array['search_path=""'] from pg_proc where oid = 'app.retention_cleanup(timestamptz)'::regprocedure), 'the cleanup function pins an empty search path');
select is((select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'app.retention_cleanup(timestamptz)'::regprocedure), 'app_migrator', 'the cleanup function is owned by the migration role');
select is(has_function_privilege('app_runtime', 'app.retention_cleanup(timestamptz)', 'execute'), false, 'the runtime role cannot execute the cross-tenant cleanup');
select is(has_function_privilege('app_migrator', 'app.retention_cleanup(timestamptz)', 'execute'), true, 'the migration role can execute the cleanup');
select is((select count(*)::integer from pg_policies where schemaname = 'app' and policyname like '%\_retention\_%'), 26, 'the migration role gets read and delete retention policies on the thirteen tables (7d adds auth windows, then counters, then agent access, then rate windows, then support reports)');

-- The nightly job is scheduled, active, on this database, and calls the cleanup boundary.
select is((select count(*)::integer from cron.job where jobname = 'staywise-retention-cleanup'), 1, 'one nightly retention job is scheduled');
select is((select schedule from cron.job where jobname = 'staywise-retention-cleanup'), '17 3 * * *', 'the job runs at 03:17 nightly');
select is((select command from cron.job where jobname = 'staywise-retention-cleanup'), 'select app.retention_cleanup()', 'the job calls the cleanup function');
select is((select active from cron.job where jobname = 'staywise-retention-cleanup'), true, 'the job is active');
select is((select database::text from cron.job where jobname = 'staywise-retention-cleanup'), current_database()::text, 'the job targets the migrated database');
select is((select username::text from cron.job where jobname = 'staywise-retention-cleanup'), current_user::text, 'the job runs as the scheduling role');

-- Run the cleanup twice under forced RLS as the definer function's own non-superuser role.
set local role app_migrator;
create temp table probe_retention_first on commit drop as select app.retention_cleanup('2026-10-19T12:00:00Z'::timestamptz) as result;
create temp table probe_retention_second on commit drop as select app.retention_cleanup('2026-10-19T12:00:00Z'::timestamptz) as result;
reset role;

select is((select (result->>'guest_messages')::integer from probe_retention_first), 2, 'expired messages in two properties are deleted once');
select is((select (result->>'audit_events')::integer from probe_retention_first), 1, 'expired audit events are deleted');
select is((select (result->>'setup_events')::integer from probe_retention_first), 1, 'expired setup events are deleted');
select is((select (result->>'reservations')::integer from probe_retention_first), 2, 'reservations past stay end by more than 90 days are deleted');
select is((select (result->>'share_links')::integer from probe_retention_first), 1, 'disabled-link metadata past 30 days is deleted');
select is((select (result->>'guest_sessions')::integer from probe_retention_first), 2, 'expired guest sessions are deleted');
select is((select (result->>'rate_limits')::integer from probe_retention_first), 1, 'rate windows before the boundary UTC day are deleted');
select is((select result - 'boundary' from probe_retention_second), '{"guest_messages": 0, "audit_events": 0, "setup_events": 0, "reservations": 0, "share_links": 0, "guest_sessions": 0, "rate_limits": 0, "auth_rate_limits": 0, "guest_counters": 0, "guide_section_revisions": 0, "agent_grant_tokens": 0, "agent_grants": 0, "support_reports": 0}'::jsonb, 'a second run with the same boundary deletes nothing');

select is((select count(*)::integer from app.guest_messages where property_id in ('7a7a0000-0000-4000-8000-0000000000a2', '7a7a0000-0000-4000-8000-0000000000a3', '7a7a0000-0000-4000-8000-0000000000b2')), 3, 'messages at the cutoff and fresher survive in both hosts properties');
select is((select count(*)::integer from app.guest_messages where id = '7a7a0000-0000-4000-8000-0000000000a9'), 0, 'the 91-day-old message is gone');
select is((select body from app.guest_messages where id = '7a7a0000-0000-4000-8000-0000000000ab'), 'fresh A', 'a surviving message body is untouched');
select is((select count(*)::integer from app.audit_events where actor_id = '7a7a0000-0000-4000-8000-0000000000a1'), 2, 'audit events at the cutoff and fresher survive');
select is((select count(*)::integer from app.setup_events where property_id = '7a7a0000-0000-4000-8000-0000000000a2'), 1, 'setup events at the cutoff survive');
select is((select count(*)::integer from app.reservations where external_id like 'rent-%'), 2, 'the reservation at the cutoff and the cascade fixture survive');
select is((select count(*)::integer from app.share_links where id = 'pgtap7aLinkA0000002'), 0, 'disabled metadata older than 30 days is gone');
select is((select count(*)::integer from app.guest_sessions where id = '7a7a0000-0000-4000-8000-0000000000a6'), 0, 'deleting disabled metadata takes its sessions with it');
select is((select count(*)::integer from app.share_links where id = 'pgtap7aLinkA0000003'), 1, 'disabled metadata inside 30 days survives');
select is((select count(*)::integer from app.share_links where id = 'pgtap7aLinkA0000001' and enabled), 1, 'an old enabled link is never treated as disabled metadata');
select is((select count(*)::integer from app.guest_sessions where id = '7a7a0000-0000-4000-8000-0000000000a7'), 0, 'a session expiring exactly at the boundary is gone');
select is((select count(*)::integer from app.guest_sessions where id = '7a7a0000-0000-4000-8000-0000000000a8'), 1, 'a session one second past the boundary survives');
select is((select count(*)::integer from app.rate_limits where key_hash = '\x21'), 0, 'the previous UTC day rate window is gone');
select is((select count(*)::integer from app.rate_limits where key_hash = '\x22'), 1, 'the current UTC day rate window is kept');
select is((select (result->>'guest_counters')::integer from probe_retention_first), 1, 'counter days older than 400 days are deleted');
select is((select count(*)::integer from app.guest_counters where property_id = '7a7a0000-0000-4000-8000-0000000000a2' and day = '2025-09-14'), 1, 'the counter day exactly 400 days back survives');
select is((select submissions from app.guest_counters where property_id = '7a7a0000-0000-4000-8000-0000000000a2' and day = '2026-10-19'), 3, 'recent counters survive cleanup');
select is((select provider from app.guide_translations where section_id = '7a7a0000-0000-4000-8000-0000000000a4'), 'google-translate-v3', 'translation provider metadata stays with its live translation');
select is((select body from app.guide_sections where id = '7a7a0000-0000-4000-8000-0000000000a4'), 'Password is on the router', 'guide content is not touched by retention');

-- Property deletion removes every property-scoped row, including translations and their provider
-- metadata; the property event, reservation, counter, link, session, and message go with it.
delete from app.properties where id = '7a7a0000-0000-4000-8000-0000000000c2';
select is((select count(*)::integer from app.guide_sections where property_id = '7a7a0000-0000-4000-8000-0000000000c2'), 0, 'property deletion removes its sections');
select is((select count(*)::integer from app.guide_translations where section_id = '7a7a0000-0000-4000-8000-0000000000c4'), 0, 'property deletion removes translations with their provider metadata');
select is((select count(*)::integer from app.share_links where property_id = '7a7a0000-0000-4000-8000-0000000000c2'), 0, 'property deletion removes its links');
select is((select count(*)::integer from app.guest_sessions where id = '7a7a0000-0000-4000-8000-0000000000c6'), 0, 'property deletion removes its sessions through the link cascade');
select is((select count(*)::integer from app.guest_messages where property_id = '7a7a0000-0000-4000-8000-0000000000c2'), 0, 'property deletion removes its messages');
select is((select count(*)::integer from app.guest_counters where property_id = '7a7a0000-0000-4000-8000-0000000000c2'), 0, 'property deletion removes its counters');
select is((select count(*)::integer from app.reservations where property_id = '7a7a0000-0000-4000-8000-0000000000c2'), 0, 'property deletion removes its reservations');
select is((select count(*)::integer from app.setup_events where property_id = '7a7a0000-0000-4000-8000-0000000000c2'), 0, 'property deletion removes its setup events');

select * from finish();
rollback;
