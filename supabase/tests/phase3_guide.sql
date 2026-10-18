-- Phase 3 guide-authoring constraints, funnel vocabulary, and per-owner isolation.
begin;

create extension if not exists pgtap;

select plan(13);

-- Test-local: pg_prove connects as the migration runner, which needs SET ROLE on the runtime
-- role to exercise RLS; both the grant and the probes roll back with this transaction.
do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

-- Fixtures; this file's runner inserts bypass forced RLS; the whole file rolls back.
insert into auth.users (id, email) values
  ('79000000-0000-4000-8000-0000000000a1', 'pgtap-guide-a@example.test'),
  ('79000000-0000-4000-8000-0000000000b1', 'pgtap-guide-b@example.test');
insert into app.properties (id, owner_id, display_name) values
  ('79000000-0000-4000-8000-0000000000a2', '79000000-0000-4000-8000-0000000000a1', 'Guide property A'),
  ('79000000-0000-4000-8000-0000000000b2', '79000000-0000-4000-8000-0000000000b1', 'Guide property B');
insert into app.guide_sections (id, property_id, category, title, body, visibility) values
  ('79000000-0000-4000-8000-0000000000a3', '79000000-0000-4000-8000-0000000000a2', 'wifi', 'Wi-Fi', 'Synthetic network details', 'guest'),
  ('79000000-0000-4000-8000-0000000000b3', '79000000-0000-4000-8000-0000000000b2', 'wifi', 'Wi-Fi', 'Synthetic other-owner details', 'guest');

set local role app_runtime;
select set_config('app.owner_id', '79000000-0000-4000-8000-0000000000a1', true);

-- A secret value is rejected on a guest-visible section and accepted on a private note.
create temp table probe_secret_guest (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guide_sections (property_id, category, title, body, visibility, secret_value)
      values ('79000000-0000-4000-8000-0000000000a2', 'arrival', 'x', 'y', 'guest', 'Synthetic secret value');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_secret_guest (blocked, err_state) values (blocked, err_state);
end $$;
create temp table probe_secret_host on commit drop as
  with ins as (
    insert into app.guide_sections (property_id, category, title, body, visibility, secret_value)
      values ('79000000-0000-4000-8000-0000000000a2', 'emergency', 'Private note', 'Synthetic note', 'host', 'Synthetic secret value')
      returning 1 as n
  )
  select count(*)::bigint as n from ins;

-- Cross-owner section writes stay invisible and blocked after the new column.
create temp table probe_update_b on commit drop as
  with changed as (
    update app.guide_sections set secret_value = 'Synthetic takeover', visibility = 'host'
    where id = '79000000-0000-4000-8000-0000000000b3' returning 1
  )
  select count(*)::bigint as changed from changed;
create temp table probe_insert_b (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guide_sections (property_id, category, title, body, visibility)
      values ('79000000-0000-4000-8000-0000000000b2', 'wifi', 'cross-owner', 'x', 'guest');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_insert_b (blocked, err_state) values (blocked, err_state);
end $$;

-- Publish/unpublish are valid audit actions; anything else stays rejected.
create temp table probe_audit_publish on commit drop as
  with ins as (
    insert into app.audit_events (actor_id, action)
      values ('79000000-0000-4000-8000-0000000000a1', 'publish'), ('79000000-0000-4000-8000-0000000000a1', 'unpublish')
      returning 1 as n
  )
  select count(*)::bigint as n from ins;
create temp table probe_audit_bogus (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.audit_events (actor_id, action)
      values ('79000000-0000-4000-8000-0000000000a1', 'delete_everything');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_audit_bogus (blocked, err_state) values (blocked, err_state);
end $$;

-- The six funnel event types are valid for the host; other names and foreign owners are not.
create temp table probe_setup_types on commit drop as
  with ins as (
    insert into app.setup_events (owner_id, event_type, property_id, step)
      values
        ('79000000-0000-4000-8000-0000000000a1', 'sign_in', null, null),
        ('79000000-0000-4000-8000-0000000000a1', 'property_created', '79000000-0000-4000-8000-0000000000a2', 'blank'),
        ('79000000-0000-4000-8000-0000000000a1', 'section_saved', '79000000-0000-4000-8000-0000000000a2', 'wifi'),
        ('79000000-0000-4000-8000-0000000000a1', 'preview_opened', '79000000-0000-4000-8000-0000000000a2', null),
        ('79000000-0000-4000-8000-0000000000a1', 'publish_clicked', '79000000-0000-4000-8000-0000000000a2', null),
        ('79000000-0000-4000-8000-0000000000a1', 'support_requested', null, null)
      returning 1 as n
  )
  select count(*)::bigint as n from ins;
create temp table probe_setup_bogus (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.setup_events (owner_id, event_type) values ('79000000-0000-4000-8000-0000000000a1', 'curated_telemetry');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_setup_bogus (blocked, err_state) values (blocked, err_state);
end $$;
create temp table probe_setup_foreign (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.setup_events (owner_id, event_type) values ('79000000-0000-4000-8000-0000000000b1', 'sign_in');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_setup_foreign (blocked, err_state) values (blocked, err_state);
end $$;

reset role;
select set_config('app.owner_id', '', true);

select is((select blocked from probe_secret_guest), true, 'a secret on a guest section is rejected');
select is((select err_state from probe_secret_guest), '23514', 'guest secret rejection is a check violation');
select is((select n from probe_secret_host), 1::bigint, 'a secret on a private note is accepted');
select is((select changed from probe_update_b), 0::bigint, 'owner context cannot update another host sections');
select is((select blocked from probe_insert_b), true, 'inserting into another host property is blocked');
select is((select err_state from probe_insert_b), '42501', 'cross-owner section insert fails with an RLS violation');
select is((select n from probe_audit_publish), 2::bigint, 'publish and unpublish are valid audit actions');
select is((select blocked from probe_audit_bogus), true, 'unknown audit actions stay rejected');
select is((select n from probe_setup_types), 6::bigint, 'all six funnel event types are accepted');
select is((select blocked from probe_setup_bogus), true, 'unknown setup event types are rejected');
select is((select err_state from probe_setup_bogus), '23514', 'unknown setup event type fails the check constraint');
select is((select blocked from probe_setup_foreign), true, 'setup events for another host are blocked');
select is((select err_state from probe_setup_foreign), '42501', 'foreign-owner setup event fails with an RLS violation');

select * from finish();
rollback;
