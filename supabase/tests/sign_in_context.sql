-- Sign-in context columns on audit rows: typed, capped, and only on sign-in events. Synthetic; rolls back.
begin;

create extension if not exists pgtap;

select plan(9);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

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

select has_index('app', 'audit_events', 'audit_events_sign_in_device_idx', 'the new-device lookup has an owner-leading index');

insert into auth.users (id, email) values ('51900000-0000-4000-8000-0000000000a1', 'sign-in-context@example.test');

select is(
  pg_temp.state_as('51900000-0000-4000-8000-0000000000a1', $$insert into app.audit_events
    (actor_id, action, device_label, country_code, city, new_device)
    values ('51900000-0000-4000-8000-0000000000a1', 'mfa_verified', 'Firefox on Linux', 'SI', 'Ljubljana', true)$$),
  'ok', 'the runtime appends a two-step verification with its sign-in context');
select is(
  pg_temp.state_as('51900000-0000-4000-8000-0000000000a1', $$insert into app.audit_events (actor_id, action, device_label)
    values ('51900000-0000-4000-8000-0000000000a1', 'publish', 'Firefox on Linux')$$),
  '23514', 'only sign-in events carry sign-in context');
select is(
  pg_temp.state_as('51900000-0000-4000-8000-0000000000a1', $$insert into app.audit_events (actor_id, action, country_code)
    values ('51900000-0000-4000-8000-0000000000a1', 'sign_in', 'si')$$),
  '23514', 'a country is a two-letter upper-case code');
select is(
  pg_temp.state_as('51900000-0000-4000-8000-0000000000a1', $$insert into app.audit_events (actor_id, action, city)
    values ('51900000-0000-4000-8000-0000000000a1', 'sign_in', repeat('x', 81))$$),
  '23514', 'a city is at most 80 characters');
select is(
  pg_temp.state_as('51900000-0000-4000-8000-0000000000a1', $$insert into app.audit_events (actor_id, action, city)
    values ('51900000-0000-4000-8000-0000000000a1', 'sign_in', E'Bled\n')$$),
  '23514', 'a city has no control characters');
select is(
  pg_temp.state_as('51900000-0000-4000-8000-0000000000a1', $$insert into app.audit_events (actor_id, action, device_label)
    values ('51900000-0000-4000-8000-0000000000a1', 'sign_in', repeat('x', 61))$$),
  '23514', 'a device label is at most 60 characters');
select is(
  pg_temp.state_as('51900000-0000-4000-8000-0000000000a1', $$update app.audit_events set city = 'Bled'
    where actor_id = '51900000-0000-4000-8000-0000000000a1'$$),
  '42501', 'the runtime cannot rewrite sign-in context');

delete from auth.users where id = '51900000-0000-4000-8000-0000000000a1';
select is(
  (select row(actor_id, device_label, country_code, city, new_device)::text from app.audit_events
    where id = (select max(id) from app.audit_events where action = 'mfa_verified')),
  '(,,,,)', 'deleting the account drops the sign-in context with the actor');

select * from finish();
rollback;
