-- Support reports are owner-scoped and append-only for the runtime; retention is 90 days. Synthetic; rolls back.
begin;

create extension if not exists pgtap;

select plan(5);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;
do $$ begin execute format('grant app_migrator to %I with set true', current_user); end $$;

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

insert into auth.users (id, email) values
  ('5e500000-0000-4000-8000-0000000000a1', 'support-a@example.test'),
  ('5e500000-0000-4000-8000-0000000000b1', 'support-b@example.test');

select is(
  pg_temp.state_as('5e500000-0000-4000-8000-0000000000a1', $$insert into app.support_reports (owner_id, kind, message)
    values ('5e500000-0000-4000-8000-0000000000a1', 'issue', 'Photo upload fails')$$),
  'ok', 'a host files a report for themselves');
select is(
  pg_temp.state_as('5e500000-0000-4000-8000-0000000000a1', $$insert into app.support_reports (owner_id, kind, message)
    values ('5e500000-0000-4000-8000-0000000000b1', 'help', 'Impersonation')$$),
  '42501', 'a host cannot file a report as another host');
select is(
  pg_temp.state_as('5e500000-0000-4000-8000-0000000000a1', $$insert into app.support_reports (owner_id, kind, message)
    values ('5e500000-0000-4000-8000-0000000000a1', 'help', '')$$),
  '23514', 'an empty report is rejected');
select is(
  pg_temp.state_as('5e500000-0000-4000-8000-0000000000a1', $$delete from app.support_reports$$),
  '42501', 'the runtime cannot delete reports');

insert into app.support_reports (owner_id, kind, message, created_at) values
  ('5e500000-0000-4000-8000-0000000000a1', 'help', 'old', '2026-07-21T11:59:59Z'),
  ('5e500000-0000-4000-8000-0000000000a1', 'help', 'edge', '2026-07-21T12:00:00Z');

set local role app_migrator;
create temp table probe_cleanup on commit drop as select app.retention_cleanup('2026-10-19T12:00:00Z'::timestamptz) as result;
reset role;

select is(
  (select array_agg(message order by message) from app.support_reports where message in ('old', 'edge')),
  array['edge'], 'support reports are kept for 90 days');

select * from finish();
rollback;
