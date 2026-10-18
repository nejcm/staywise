-- Phase 2 role, grant, and RLS matrix against the real local database.
begin;

create extension if not exists pgtap;

select plan(31);

-- Test-local: pg_prove connects as the migration runner, which needs SET ROLE on the runtime
-- role to exercise RLS; both the grant and the probes roll back with this transaction.
do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

-- Roles are exactly as restricted as the plan requires.
select is((select rolsuper from pg_roles where rolname = 'app_runtime'), false, 'app_runtime is not a superuser');
select is((select rolbypassrls from pg_roles where rolname = 'app_runtime'), false, 'app_runtime cannot bypass RLS');
select is((select rolcanlogin from pg_roles where rolname = 'app_runtime'), true, 'app_runtime can log in');
select is((select rolsuper from pg_roles where rolname = 'app_migrator'), false, 'app_migrator is not a superuser');
select is((select rolcanlogin from pg_roles where rolname = 'app_migrator'), false, 'app_migrator cannot log in');

-- Ownership separation: the runtime role owns nothing and every app object belongs to the migrator.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r' and c.relowner <> 'app_migrator'::regrole),
  0::bigint,
  'every app table is owned by app_migrator'
);
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'S' and c.relowner <> 'app_migrator'::regrole),
  0::bigint,
  'every app sequence is owned by app_migrator'
);
select is(
  (select rolname from pg_roles r join pg_namespace n on n.nspowner = r.oid where n.nspname = 'app'),
  'app_migrator',
  'app schema is owned by app_migrator'
);

-- Forced RLS on every app table.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity),
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'),
  'RLS is enabled and forced on every app table'
);

-- Data API roles hold no access to the app schema.
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon has no usage on the app schema');
select ok(not has_schema_privilege('authenticated', 'app', 'usage'), 'authenticated has no usage on the app schema');
select ok(not has_table_privilege('anon', 'app.properties', 'select'), 'anon cannot select properties');
select ok(not has_table_privilege('authenticated', 'app.properties', 'insert'), 'authenticated cannot insert properties');
select ok(not has_table_privilege('anon', 'app.audit_events', 'select'), 'anon cannot select audit events');

-- The runtime role holds exactly the granted operations.
select ok(has_table_privilege('app_runtime', 'app.properties', 'select'), 'runtime can select properties');
select ok(has_table_privilege('app_runtime', 'app.audit_events', 'insert'), 'runtime can insert audit events');
select ok(not has_table_privilege('app_runtime', 'app.audit_events', 'update'), 'runtime cannot update audit events');
select ok(not has_table_privilege('app_runtime', 'app.audit_events', 'delete'), 'runtime cannot delete audit events');

-- Synthetic fixtures; the whole file rolls back.
insert into auth.users (id, email) values
  ('78000000-0000-4000-8000-0000000000a1', 'pgtap-host-a@example.test'),
  ('78000000-0000-4000-8000-0000000000b1', 'pgtap-host-b@example.test');
insert into app.properties (id, owner_id, display_name) values
  ('78000000-0000-4000-8000-0000000000a2', '78000000-0000-4000-8000-0000000000a1', 'Property A'),
  ('78000000-0000-4000-8000-0000000000b2', '78000000-0000-4000-8000-0000000000b1', 'Property B');

-- Host isolation as the limited runtime role with transaction-local owner context.
set local role app_runtime;
select set_config('app.owner_id', '78000000-0000-4000-8000-0000000000a1', true);
create temp table probe_visible_a on commit drop as  select count(*)::bigint as visible from app.properties;
create temp table probe_update_b on commit drop as
  with changed as (
    update app.properties set display_name = 'changed'
    where id = '78000000-0000-4000-8000-0000000000b2' returning 1
  )
  select count(*)::bigint as changed from changed;
create temp table probe_wrong_insert (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.properties (owner_id, display_name)
      values ('78000000-0000-4000-8000-0000000000b1', 'cross-owner');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_wrong_insert (blocked, err_state) values (blocked, err_state);
end $$;
create temp table probe_audit_ok on commit drop as
  with ins as (
    insert into app.audit_events (actor_id, action)
      values ('78000000-0000-4000-8000-0000000000a1', 'sign_in') returning 1 as n
  )
  select n from ins;
create temp table probe_audit_bad (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.audit_events (actor_id, action)
      values ('78000000-0000-4000-8000-0000000000b1', 'sign_in');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_audit_bad (blocked, err_state) values (blocked, err_state);
end $$;
create temp table probe_rate on commit drop as
  with ins as (
    insert into app.rate_limits (key_hash, window_start) values (decode('00', 'hex'), now()) returning 1 as n
  )
  select n from ins;
reset role;
select set_config('app.owner_id', '', true);

set local role app_runtime;
create temp table probe_no_context on commit drop as
  select count(*)::bigint as visible from app.properties;
reset role;

select is((select visible from probe_visible_a), 1::bigint, 'owner context exposes exactly its own property');
select is((select changed from probe_update_b), 0::bigint, 'owner context cannot update another host rows');
select is((select visible from probe_no_context), 0::bigint, 'missing owner context exposes no rows');
select is((select blocked from probe_wrong_insert), true, 'inserting another host row is blocked');
select is((select err_state from probe_wrong_insert), '42501', 'cross-owner insert fails with an RLS violation');
select is((select count(*) from probe_audit_ok), 1::bigint, 'runtime records an audit event in owner context');
select is((select blocked from probe_audit_bad), true, 'audit insert with a foreign actor is blocked');
select is((select err_state from probe_audit_bad), '42501', 'foreign-actor audit insert fails with an RLS violation');
select is((select count(*) from probe_rate), 1::bigint, 'runtime writes fingerprint counters without owner context');
select is(app.current_owner_id(), null, 'owner context is null when unset');

-- Safe defaults: a table created later by the migration role is not reachable by the API roles or runtime.
set local role app_migrator;
create table app.later_probe (id int);
reset role;
select ok(not has_table_privilege('app_runtime', 'app.later_probe', 'select'), 'runtime gets no default grants on new tables');
select ok(not has_table_privilege('anon', 'app.later_probe', 'select'), 'anon gets no default grants on new tables');
select is(
  (select count(*) from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'app' and array_to_string(d.defaclacl, ',') ~ '(anon|authenticated)'),
  0::bigint,
  'no default ACL grants to anon or authenticated in the app schema'
);
set local role app_migrator;
drop table app.later_probe;
reset role;

select * from finish();
rollback;
