-- Phase 7c: property deletion is complete and immediate. Rate-limit fingerprints now belong to a
-- property and cascade with it; the host delete action has its own audit vocabulary.
begin;

create extension if not exists pgtap;

select plan(19);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

insert into auth.users (id, email) values
  ('7c7c0000-0000-4000-8000-0000000000a1', 'pgtap-7c-a@example.test'),
  ('7c7c0000-0000-4000-8000-0000000000b1', 'pgtap-7c-b@example.test');
insert into app.properties (id, owner_id, display_name) values
  ('7c7c0000-0000-4000-8000-0000000000a2', '7c7c0000-0000-4000-8000-0000000000a1', 'Delete A'),
  ('7c7c0000-0000-4000-8000-0000000000b2', '7c7c0000-0000-4000-8000-0000000000b1', 'Keep B');
insert into app.guide_sections (id, property_id, category, title, body) values
  ('7c7c0000-0000-4000-8000-0000000000a4', '7c7c0000-0000-4000-8000-0000000000a2', 'wifi', 'A', 'A body'),
  ('7c7c0000-0000-4000-8000-0000000000b4', '7c7c0000-0000-4000-8000-0000000000b2', 'wifi', 'B', 'B body');
insert into app.guide_translations (id, section_id, locale, title, body, source_revision, state, provider) values
  ('7c7c0000-0000-4000-8000-0000000000a5', '7c7c0000-0000-4000-8000-0000000000a4', 'de', 'A', 'A', 1, 'approved', 'google-translate-v3'),
  ('7c7c0000-0000-4000-8000-0000000000b5', '7c7c0000-0000-4000-8000-0000000000b4', 'de', 'B', 'B', 1, 'approved', 'google-translate-v3');
insert into app.share_links (id, secret_hmac, property_id) values
  ('pgtap7cLinkA0000001', '\x0102', '7c7c0000-0000-4000-8000-0000000000a2'),
  ('pgtap7cLinkB0000001', '\x0102', '7c7c0000-0000-4000-8000-0000000000b2');
insert into app.guest_sessions (id, session_hash, share_link_id, expires_at) values
  ('7c7c0000-0000-4000-8000-0000000000a6', '\x11', 'pgtap7cLinkA0000001', now() + interval '1 hour'),
  ('7c7c0000-0000-4000-8000-0000000000b6', '\x12', 'pgtap7cLinkB0000001', now() + interval '1 hour');
insert into app.guest_messages (id, property_id, kind, category, body) values
  ('7c7c0000-0000-4000-8000-0000000000a9', '7c7c0000-0000-4000-8000-0000000000a2', 'question', 'wifi', 'A message'),
  ('7c7c0000-0000-4000-8000-0000000000b9', '7c7c0000-0000-4000-8000-0000000000b2', 'question', 'wifi', 'B message');
insert into app.rate_limits (property_id, key_hash, window_start, count) values
  ('7c7c0000-0000-4000-8000-0000000000a2', '\x21', now(), 1),
  ('7c7c0000-0000-4000-8000-0000000000a2', '\x22', now(), 1),
  ('7c7c0000-0000-4000-8000-0000000000a2', '\x23', now(), 1),
  ('7c7c0000-0000-4000-8000-0000000000a2', '\x24', now(), 1),
  ('7c7c0000-0000-4000-8000-0000000000b2', '\x25', now(), 1);
insert into app.guest_counters (property_id, day, link_exchanges, guide_opens, submissions) values
  ('7c7c0000-0000-4000-8000-0000000000a2', '2026-10-19', 1, 1, 1);
insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end) values
  ('7c7c0000-0000-4000-8000-0000000000ad', '7c7c0000-0000-4000-8000-0000000000a2', 'pgtap', '7c-a', '2026-10-01', '2026-10-05');
insert into app.setup_events (owner_id, event_type, property_id, step) values
  ('7c7c0000-0000-4000-8000-0000000000a1', 'section_saved', '7c7c0000-0000-4000-8000-0000000000a2', 'wifi');
insert into app.api_tokens (owner_id, token_hash, scopes, property_id) values
  ('7c7c0000-0000-4000-8000-0000000000a1', '\x31', '{content:write}', '7c7c0000-0000-4000-8000-0000000000a2');

select is((select is_nullable from information_schema.columns where table_schema = 'app' and table_name = 'rate_limits' and column_name = 'property_id'), 'NO', 'every rate fingerprint has a property');
select is((select confdeltype::text from pg_constraint where conname = 'rate_limits_property_fk'), 'c', 'the rate fingerprint property FK cascades on delete');
select is((select count(*)::integer from pg_indexes where schemaname = 'app' and tablename = 'rate_limits' and indexdef like '%property_id%'), 1, 'the cascade has a property index');

set local role app_runtime;
select set_config('app.owner_id', '7c7c0000-0000-4000-8000-0000000000a1', true);
create temp table probe_delete_a on commit drop as
  with deleted as (
    delete from app.properties where id = '7c7c0000-0000-4000-8000-0000000000a2' returning 1
  )
  select count(*)::integer as n from deleted;
create temp table probe_delete_b on commit drop as
  with deleted as (
    delete from app.properties where id = '7c7c0000-0000-4000-8000-0000000000b2' returning 1
  )
  select count(*)::integer as n from deleted;
insert into app.audit_events (actor_id, action) values ('7c7c0000-0000-4000-8000-0000000000a1', 'delete');
reset role;
select set_config('app.owner_id', '', true);

select is((select n from probe_delete_a), 1, 'the owner can delete its property');
select is((select n from probe_delete_b), 0, 'the owner cannot delete another host property');
select is((select count(*)::integer from app.properties where id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'the deleted property is gone immediately');
select is((select count(*)::integer from app.guide_sections where property_id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'deletion removes its sections');
select is((select count(*)::integer from app.guide_translations where id = '7c7c0000-0000-4000-8000-0000000000a5'), 0, 'deletion removes translations with provider metadata');
select is((select count(*)::integer from app.share_links where property_id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'deletion removes its links');
select is((select count(*)::integer from app.guest_sessions where id = '7c7c0000-0000-4000-8000-0000000000a6'), 0, 'deletion removes active sessions');
select is((select count(*)::integer from app.guest_messages where property_id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'deletion removes messages');
select is((select count(*)::integer from app.rate_limits where property_id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'deletion removes every rate fingerprint, not only old windows');
select is((select count(*)::integer from app.guest_counters where property_id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'deletion removes counters');
select is((select count(*)::integer from app.reservations where property_id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'deletion removes reservations');
select is((select count(*)::integer from app.setup_events where property_id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'deletion removes setup events');
select is((select count(*)::integer from app.api_tokens where property_id = '7c7c0000-0000-4000-8000-0000000000a2'), 0, 'deletion removes property-scoped API tokens');
select is((select count(*)::integer from app.audit_events where actor_id = '7c7c0000-0000-4000-8000-0000000000a1' and action = 'delete'), 1, 'the delete audit row is allowed and survives the property');
select is((select count(*)::integer from app.properties where id = '7c7c0000-0000-4000-8000-0000000000b2'), 1, 'another host property is untouched');
select is((select count(*)::integer from app.rate_limits where property_id = '7c7c0000-0000-4000-8000-0000000000b2'), 1, 'another property rate fingerprint is untouched');

select * from finish();
rollback;
