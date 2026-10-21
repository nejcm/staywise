-- Agent access schema: grant and token shape, owner policies on grants, token digests and guide
-- revisions, per-property import keys, the new audit actions, and retention. Synthetic; rolls back.
begin;

create extension if not exists pgtap;

select plan(45);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;
do $$ begin execute format('grant app_migrator to %I with set true', current_user); end $$;

-- Runs one statement as the runtime role in an owner context and returns its SQLSTATE, or 'ok'.
create function pg_temp.state_as(p_owner uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_state text := 'ok';
begin
  perform set_config('app.owner_id', coalesce(p_owner::text, ''), true);
  set local role app_runtime;
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  perform set_config('app.owner_id', '', true);
  return v_state;
end $$;

create function pg_temp.count_as(p_owner uuid, p_sql text) returns integer
language plpgsql as $$
declare
  v integer;
begin
  perform set_config('app.owner_id', coalesce(p_owner::text, ''), true);
  set local role app_runtime;
  execute p_sql into v;
  reset role;
  perform set_config('app.owner_id', '', true);
  return v;
end $$;

insert into auth.users (id, email) values
  ('a6e00000-0000-4000-8000-0000000000a1', 'pgtap-agent-a@example.test'),
  ('a6e00000-0000-4000-8000-0000000000b1', 'pgtap-agent-b@example.test');
insert into app.properties (id, owner_id, display_name) values
  ('a6e00000-0000-4000-8000-0000000000a2', 'a6e00000-0000-4000-8000-0000000000a1', 'Agent A'),
  ('a6e00000-0000-4000-8000-0000000000b2', 'a6e00000-0000-4000-8000-0000000000b1', 'Agent B'),
  ('a6e00000-0000-4000-8000-0000000000c2', 'a6e00000-0000-4000-8000-0000000000a1', 'Agent cascade C');
insert into app.guide_sections (id, property_id, category, title, body) values
  ('a6e00000-0000-4000-8000-0000000000a4', 'a6e00000-0000-4000-8000-0000000000a2', 'wifi', 'A', 'A body'),
  ('a6e00000-0000-4000-8000-0000000000b4', 'a6e00000-0000-4000-8000-0000000000b2', 'wifi', 'B', 'B body'),
  ('a6e00000-0000-4000-8000-0000000000c4', 'a6e00000-0000-4000-8000-0000000000c2', 'wifi', 'C', 'C body');

-- Boundary 2026-10-19 12:00 UTC: grants and revisions use the 90-day cutoff 2026-07-21 12:00.
insert into app.agent_grants (id, owner_id, kind, name, token_hash, scopes, created_at, expires_at, revoked_at) values
  ('a6e00000-0000-4000-8000-0000000000a5', 'a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Active', sha256('pat-a5'), '{read,content:write}', '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z', null),
  ('a6e00000-0000-4000-8000-0000000000a6', 'a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Revoked old', sha256('pat-a6'), '{read}', '2026-06-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-07-20T12:00:00Z'),
  ('a6e00000-0000-4000-8000-0000000000a7', 'a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Revoked recent', sha256('pat-a7'), '{read}', '2026-06-01T00:00:00Z', '2026-08-29T00:00:00Z', '2026-07-22T00:00:00Z'),
  ('a6e00000-0000-4000-8000-0000000000a8', 'a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Expired old', sha256('pat-a8'), '{read}', '2026-04-15T00:00:00Z', '2026-07-13T00:00:00Z', null),
  ('a6e00000-0000-4000-8000-0000000000aa', 'a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Revoked after expiry', sha256('pat-aa'), '{read}', '2026-05-01T00:00:00Z', '2026-07-20T00:00:00Z', '2026-08-01T00:00:00Z'),
  ('a6e00000-0000-4000-8000-0000000000ab', 'a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Expired at boundary', sha256('pat-ab'), '{read}', '2026-05-01T00:00:00Z', '2026-07-21T12:00:00Z', null),
  ('a6e00000-0000-4000-8000-0000000000b5', 'a6e00000-0000-4000-8000-0000000000b1', 'pat', 'B token', sha256('pat-b5'), '{read}', '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z', null);
insert into app.agent_grants (id, owner_id, kind, name, client_id, resource, scopes, created_at, expires_at) values
  ('a6e00000-0000-4000-8000-0000000000a9', 'a6e00000-0000-4000-8000-0000000000a1', 'oauth', 'Client A', 'https://claude.ai/oauth/client.json', 'https://staywise.test/mcp', '{read}', '2026-10-01T00:00:00Z', '2026-12-29T00:00:00Z'),
  ('a6e00000-0000-4000-8000-0000000000b9', 'a6e00000-0000-4000-8000-0000000000b1', 'oauth', 'Client B', 'https://chatgpt.com/oauth/client.json', 'https://staywise.test/mcp', '{read}', '2026-10-01T00:00:00Z', '2026-12-29T00:00:00Z');
insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at) values
  (sha256('code-a9'), 'a6e00000-0000-4000-8000-0000000000a9', 'code', '2026-10-19T12:00:00Z'),
  (sha256('access-a9'), 'a6e00000-0000-4000-8000-0000000000a9', 'access', '2026-10-19T11:00:00Z'),
  (sha256('refresh-a9'), 'a6e00000-0000-4000-8000-0000000000a9', 'refresh', '2026-10-19T12:00:01Z'),
  (sha256('refresh-a6'), 'a6e00000-0000-4000-8000-0000000000a6', 'refresh', '2026-12-01T00:00:00Z'),
  (sha256('access-b9'), 'a6e00000-0000-4000-8000-0000000000b9', 'access', '2026-12-01T00:00:00Z');
insert into app.guide_section_revisions (id, section_id, grant_id, before_title, before_body, after_title, after_body, created_at) values
  ('a6e00000-0000-4000-8000-0000000000d1', 'a6e00000-0000-4000-8000-0000000000a4', 'a6e00000-0000-4000-8000-0000000000a5', 'A', 'old', 'A', 'A body', '2026-07-20T12:00:00Z'),
  ('a6e00000-0000-4000-8000-0000000000d2', 'a6e00000-0000-4000-8000-0000000000a4', 'a6e00000-0000-4000-8000-0000000000a5', null, null, 'A', 'A body', '2026-07-21T12:00:00Z'),
  ('a6e00000-0000-4000-8000-0000000000d3', 'a6e00000-0000-4000-8000-0000000000c4', 'a6e00000-0000-4000-8000-0000000000a5', null, null, 'C', 'C body', '2026-10-19T06:00:00Z'),
  ('a6e00000-0000-4000-8000-0000000000d4', 'a6e00000-0000-4000-8000-0000000000b4', 'a6e00000-0000-4000-8000-0000000000b5', null, null, 'B', 'B body', '2026-10-19T06:00:00Z'),
  ('a6e00000-0000-4000-8000-0000000000d5', 'a6e00000-0000-4000-8000-0000000000a4', 'a6e00000-0000-4000-8000-0000000000a6', null, null, 'A', 'A body', '2026-10-19T06:00:00Z');
insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end) values
  ('a6e00000-0000-4000-8000-0000000000e1', 'a6e00000-0000-4000-8000-0000000000a2', 'airbnb', 'HM-SHARED', '2026-11-01', '2026-11-05');

select hasnt_table('app', 'api_tokens', 'api_tokens is renamed away');
select ok(has_table_privilege('app_runtime', 'app.agent_grant_tokens', 'update'), 'runtime can mark a token digest used');
select ok(not has_table_privilege('app_runtime', 'app.guide_section_revisions', 'update'), 'runtime cannot rewrite a revision');
select ok(not has_table_privilege('app_runtime', 'app.agent_grants', 'delete'), 'runtime cannot delete a grant, only revoke it');

select throws_ok(
  $$insert into app.agent_grants (owner_id, kind, name, token_hash, scopes, expires_at) values ('a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Long', sha256('x1'), '{read}', now() + interval '91 days')$$,
  '23514', null, 'a grant cannot outlive 90 days');
select throws_ok(
  $$insert into app.agent_grants (owner_id, kind, name, scopes, expires_at) values ('a6e00000-0000-4000-8000-0000000000a1', 'pat', 'No digest', '{read}', now() + interval '1 day')$$,
  '23514', null, 'a personal token needs its digest');
select throws_ok(
  $$insert into app.agent_grants (owner_id, kind, name, client_id, scopes, expires_at) values ('a6e00000-0000-4000-8000-0000000000a1', 'oauth', 'No resource', 'https://claude.ai/c', '{read}', now() + interval '1 day')$$,
  '23514', null, 'an OAuth grant is bound to a resource');
select throws_ok(
  $$insert into app.agent_grants (owner_id, kind, name, token_hash, scopes, expires_at) values ('a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Admin', sha256('x2'), '{admin}', now() + interval '1 day')$$,
  '23514', null, 'unknown scopes are rejected');
select throws_ok(
  $$insert into app.agent_grants (owner_id, kind, name, token_hash, scopes, expires_at) values ('a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Short', '\x01', '{read}', now() + interval '1 day')$$,
  '23514', null, 'a token digest is 32 bytes');
select throws_ok(
  $$insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at, used_at) values (sha256('x3'), 'a6e00000-0000-4000-8000-0000000000a9', 'access', now(), now())$$,
  '23514', null, 'only codes and refresh tokens are marked used');

select is(pg_temp.count_as('a6e00000-0000-4000-8000-0000000000a1', 'select count(*)::integer from app.agent_grants'), 7, 'the owner sees exactly its own grants');
select is(pg_temp.count_as(null, 'select count(*)::integer from app.agent_grants'), 0, 'no owner context sees no grants');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$insert into app.agent_grants (owner_id, kind, name, token_hash, scopes, expires_at) values ('a6e00000-0000-4000-8000-0000000000b1', 'pat', 'Cross', sha256('x4'), '{read}', now() + interval '1 day')$$),
  '42501', 'a grant cannot be created for another host');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$insert into app.agent_grants (owner_id, kind, name, token_hash, scopes, property_id, expires_at) values ('a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Cross property', sha256('x5'), '{read}', 'a6e00000-0000-4000-8000-0000000000b2', now() + interval '1 day')$$),
  '42501', 'a grant cannot be restricted to another host property');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$insert into app.agent_grants (owner_id, kind, name, token_hash, scopes, property_id, expires_at) values ('a6e00000-0000-4000-8000-0000000000a1', 'pat', 'Own property', sha256('x6'), '{read}', 'a6e00000-0000-4000-8000-0000000000a2', now() + interval '1 day')$$),
  'ok', 'a grant can be restricted to an own property');
select is(pg_temp.count_as('a6e00000-0000-4000-8000-0000000000a1',
  $$with u as (update app.agent_grants set revoked_at = now() where id = 'a6e00000-0000-4000-8000-0000000000b5' returning 1) select count(*)::integer from u$$),
  0, 'the owner cannot revoke another host grant');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$update app.agent_grants set expires_at = expires_at + interval '1 day', scopes = '{read,inbox:write}' where id = 'a6e00000-0000-4000-8000-0000000000a5'$$),
  '42501', 'the owner cannot extend or widen its own grant');

select is(pg_temp.count_as('a6e00000-0000-4000-8000-0000000000a1', 'select count(*)::integer from app.agent_grant_tokens'), 4, 'the owner sees only token digests of its own grants');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at) values (sha256('x7'), 'a6e00000-0000-4000-8000-0000000000b9', 'access', now() + interval '1 hour')$$),
  '42501', 'a token digest cannot be added to another host grant');
select is(pg_temp.count_as('a6e00000-0000-4000-8000-0000000000a1',
  $$with u as (update app.agent_grant_tokens set expires_at = now() + interval '1 year' where grant_id = 'a6e00000-0000-4000-8000-0000000000b9' returning 1) select count(*)::integer from u$$),
  0, 'another host token digest cannot be extended');

select is(pg_temp.count_as('a6e00000-0000-4000-8000-0000000000a1', 'select count(*)::integer from app.guide_section_revisions'), 4, 'the owner sees only revisions of its own sections');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$insert into app.guide_section_revisions (section_id, grant_id, after_title, after_body) values ('a6e00000-0000-4000-8000-0000000000b4', 'a6e00000-0000-4000-8000-0000000000a5', 'x', 'x')$$),
  '42501', 'a revision cannot be written for another host section');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$insert into app.guide_section_revisions (section_id, grant_id, after_title, after_body) values ('a6e00000-0000-4000-8000-0000000000a4', 'a6e00000-0000-4000-8000-0000000000b5', 'x', 'x')$$),
  '42501', 'a revision cannot name another host grant');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$insert into app.guide_section_revisions (section_id, grant_id, before_title, before_body, after_title, after_body) values ('a6e00000-0000-4000-8000-0000000000a4', 'a6e00000-0000-4000-8000-0000000000a5', 'A', 'A body', 'A', 'new')$$),
  'ok', 'the owner records a revision for its own section and grant');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$update app.guide_section_revisions set after_body = 'rewritten' where id = 'a6e00000-0000-4000-8000-0000000000d2'$$),
  '42501', 'a revision cannot be rewritten');

-- Host B imports the same airbnb reservation ID host A already holds.
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000b1',
  $$insert into app.reservations (property_id, source, external_id, stay_start, stay_end) values ('a6e00000-0000-4000-8000-0000000000b2', 'airbnb', 'HM-SHARED', '2026-11-01', '2026-11-05')$$),
  'ok', 'another host imports the same source and external ID without a collision');
select is(pg_temp.count_as('a6e00000-0000-4000-8000-0000000000b1', $$select count(*)::integer from app.reservations where source = 'airbnb' and external_id = 'HM-SHARED'$$),
  1, 'the importing host sees only its own row');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000b1',
  $$insert into app.reservations (property_id, source, external_id, stay_start, stay_end) values ('a6e00000-0000-4000-8000-0000000000b2', 'airbnb', 'HM-SHARED', '2026-11-02', '2026-11-06')
    on conflict (property_id, source, external_id) do update set stay_start = excluded.stay_start, stay_end = excluded.stay_end$$),
  'ok', 'a re-import upserts on the per-property key');
select is((select stay_end::text from app.reservations where property_id = 'a6e00000-0000-4000-8000-0000000000b2' and external_id = 'HM-SHARED'), '2026-11-06', 'the re-import updates the importing host row');
select is((select stay_end::text from app.reservations where id = 'a6e00000-0000-4000-8000-0000000000e1'), '2026-11-05', 'the other host row is untouched');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000b1',
  $$insert into app.reservations (property_id, source, external_id, stay_start, stay_end) values ('a6e00000-0000-4000-8000-0000000000a2', 'airbnb', 'HM-SHARED', '2026-11-02', '2026-11-06')
    on conflict (property_id, source, external_id) do update set stay_end = excluded.stay_end$$),
  '42501', 'an upsert into another host property fails when the row exists');
select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000b1',
  $$insert into app.reservations (property_id, source, external_id, stay_start, stay_end) values ('a6e00000-0000-4000-8000-0000000000a2', 'airbnb', 'HM-ABSENT', '2026-11-02', '2026-11-06')
    on conflict (property_id, source, external_id) do update set stay_end = excluded.stay_end$$),
  '42501', 'and fails the same way when it does not, so the error reveals nothing');
select throws_ok(
  $$insert into app.reservations (property_id, source, external_id, stay_start, stay_end) values ('a6e00000-0000-4000-8000-0000000000a2', 'airbnb', 'HM-SHARED', '2026-11-01', '2026-11-05')$$,
  '23505', null, 'one property still holds a source and external ID once');

select is(pg_temp.state_as('a6e00000-0000-4000-8000-0000000000a1',
  $$insert into app.audit_events (actor_id, action) values
    ('a6e00000-0000-4000-8000-0000000000a1', 'agent_tool_call'),
    ('a6e00000-0000-4000-8000-0000000000a1', 'agent_grant_created'),
    ('a6e00000-0000-4000-8000-0000000000a1', 'agent_grant_revoked'),
    ('a6e00000-0000-4000-8000-0000000000a1', 'agent_grants_revoked_all')$$),
  'ok', 'the runtime appends the agent audit actions');
select throws_ok(
  $$insert into app.audit_events (actor_id, action) values ('a6e00000-0000-4000-8000-0000000000a1', 'agent_token_rotated')$$,
  '23514', null, 'unknown audit actions are still rejected');

set local role app_migrator;
create temp table probe_agent_first on commit drop as select app.retention_cleanup('2026-10-19T12:00:00Z'::timestamptz) as result;
create temp table probe_agent_second on commit drop as select app.retention_cleanup('2026-10-19T12:00:00Z'::timestamptz) as result;
reset role;

select is((select (result->>'agent_grants')::integer from probe_agent_first), 3, 'grants revoked or expired more than 90 days ago are deleted');
select is(
  (select array_agg(name order by name) from app.agent_grants where owner_id = 'a6e00000-0000-4000-8000-0000000000a1' and created_at < '2026-10-19'),
  array['Active', 'Client A', 'Expired at boundary', 'Revoked recent'],
  'active grants and grants ended at or inside the cutoff survive; a revoke after expiry counts from expiry');
select is((select (result->>'agent_grant_tokens')::integer from probe_agent_first), 2, 'token digests at or past expiry are deleted');
select is((select count(*)::integer from app.agent_grant_tokens where token_hash = sha256('refresh-a9')), 1, 'a token one second before expiry survives');
select is((select count(*)::integer from app.agent_grant_tokens where token_hash = sha256('refresh-a6')), 0, 'a deleted grant takes its live token digests with it');
select is((select (result->>'guide_section_revisions')::integer from probe_agent_first), 1, 'revisions older than 90 days are deleted');
select is((select count(*)::integer from app.guide_section_revisions where id = 'a6e00000-0000-4000-8000-0000000000d2'), 1, 'a revision at the cutoff survives');
select is((select count(*)::integer from app.guide_section_revisions where id = 'a6e00000-0000-4000-8000-0000000000d5'), 0, 'a deleted grant takes its fresh revisions with it');
select is(
  (select (result->>'agent_grants')::integer + (result->>'agent_grant_tokens')::integer + (result->>'guide_section_revisions')::integer from probe_agent_second),
  0, 'a second run with the same boundary deletes no agent rows');

delete from app.properties where id = 'a6e00000-0000-4000-8000-0000000000c2';
select is((select count(*)::integer from app.guide_section_revisions where id = 'a6e00000-0000-4000-8000-0000000000d3'), 0, 'property deletion removes its section revisions');

select * from finish();
rollback;
