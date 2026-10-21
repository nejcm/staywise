-- Account deletion: removing the auth user leaves no owner row behind, keeps other hosts intact,
-- and leaves audit rows without identity.
begin;

create extension if not exists pgtap;

select plan(10);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

select is(
  (select count(*)::integer from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and n.nspname = 'app' and c.confdeltype not in ('c', 'n')),
  0,
  'every app FK to auth.users cascades or sets null'
);

insert into auth.users (id, email) values
  ('ad0e0000-0000-4000-8000-0000000000a1', 'pgtap-delete-a@example.test'),
  ('ad0e0000-0000-4000-8000-0000000000b1', 'pgtap-delete-b@example.test');
insert into app.properties (id, owner_id, display_name) values
  ('ad0e0000-0000-4000-8000-0000000000a2', 'ad0e0000-0000-4000-8000-0000000000a1', 'Delete A'),
  ('ad0e0000-0000-4000-8000-0000000000b2', 'ad0e0000-0000-4000-8000-0000000000b1', 'Keep B');
insert into app.host_settings (owner_id) values
  ('ad0e0000-0000-4000-8000-0000000000a1'),
  ('ad0e0000-0000-4000-8000-0000000000b1');
insert into app.setup_events (owner_id, event_type) values ('ad0e0000-0000-4000-8000-0000000000a1', 'sign_in');
insert into app.agent_grants (owner_id, kind, name, token_hash, scopes, expires_at) values
  ('ad0e0000-0000-4000-8000-0000000000a1', 'pat', 'Delete A', sha256('\x41'), '{content:write}', now() + interval '30 days');
insert into app.audit_events (actor_id, action) values ('ad0e0000-0000-4000-8000-0000000000a1', 'sign_in');

-- Baselines keep the anonymous-row counts true on a local database that already holds dev audit rows.
create temp table probe_anonymous on commit drop as
  select action, count(*)::integer as n from app.audit_events where actor_id is null group by action;

delete from auth.users where id = 'ad0e0000-0000-4000-8000-0000000000a1';

select is((select count(*)::integer from app.properties where owner_id = 'ad0e0000-0000-4000-8000-0000000000a1'), 0, 'deletion removes the host properties');
select is((select count(*)::integer from app.host_settings where owner_id = 'ad0e0000-0000-4000-8000-0000000000a1'), 0, 'deletion removes the host settings');
select is((select count(*)::integer from app.setup_events where owner_id = 'ad0e0000-0000-4000-8000-0000000000a1'), 0, 'deletion removes the host setup events');
select is((select count(*)::integer from app.agent_grants where owner_id = 'ad0e0000-0000-4000-8000-0000000000a1'), 0, 'deletion removes owner-level agent grants');
select is((select count(*)::integer from app.audit_events where actor_id = 'ad0e0000-0000-4000-8000-0000000000a1'), 0, 'no audit row keeps the deleted actor');
select is((select count(*)::integer from app.audit_events where actor_id is null and action = 'sign_in'), coalesce((select n from probe_anonymous where action = 'sign_in'), 0) + 1, 'the audit row stays without identity');
select is((select count(*)::integer from app.properties where owner_id = 'ad0e0000-0000-4000-8000-0000000000b1'), 1, 'another host keeps its property');
select is((select count(*)::integer from app.host_settings where owner_id = 'ad0e0000-0000-4000-8000-0000000000b1'), 1, 'another host keeps its settings');

set local role app_runtime;
insert into app.audit_events (actor_id, action) values (null, 'account_deleted');
reset role;
select is((select count(*)::integer from app.audit_events where actor_id is null and action = 'account_deleted'), coalesce((select n from probe_anonymous where action = 'account_deleted'), 0) + 1, 'the runtime records an anonymous account deletion');

select * from finish();
rollback;
