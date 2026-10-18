-- Phase 4 guest-link constraints, link-scoped RLS, and the link audit vocabulary.
begin;

create extension if not exists pgtap;

select plan(23);

-- Test-local: pg_prove connects as the migration runner, which needs SET ROLE on the runtime
-- role to exercise RLS; both the grant and the probes roll back with this transaction.
do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

-- Fixtures; this file's runner inserts bypass forced RLS; the whole file rolls back.
insert into auth.users (id, email) values
  ('7a000000-0000-4000-8000-0000000000a1', 'pgtap-link-a@example.test'),
  ('7a000000-0000-4000-8000-0000000000b1', 'pgtap-link-b@example.test');
insert into app.properties (id, owner_id, display_name, published) values
  ('7a000000-0000-4000-8000-0000000000a2', '7a000000-0000-4000-8000-0000000000a1', 'Link property A', true),
  ('7a000000-0000-4000-8000-0000000000a6', '7a000000-0000-4000-8000-0000000000a1', 'Link property C', false),
  ('7a000000-0000-4000-8000-0000000000b2', '7a000000-0000-4000-8000-0000000000b1', 'Link property B', true);
insert into app.guide_sections (id, property_id, category, title, body, visibility, published) values
  ('7a000000-0000-4000-8000-0000000000a3', '7a000000-0000-4000-8000-0000000000a2', 'wifi', 'Guest Wi-Fi', 'Synthetic guest body', 'guest', true),
  ('7a000000-0000-4000-8000-0000000000a4', '7a000000-0000-4000-8000-0000000000a2', 'wifi', 'Private note', 'Synthetic private note', 'host', false),
  ('7a000000-0000-4000-8000-0000000000a5', '7a000000-0000-4000-8000-0000000000a2', 'wifi', 'Draft', 'Synthetic draft body', 'guest', false),
  ('7a000000-0000-4000-8000-0000000000a7', '7a000000-0000-4000-8000-0000000000a6', 'wifi', 'C', 'Synthetic C body', 'guest', true),
  ('7a000000-0000-4000-8000-0000000000b3', '7a000000-0000-4000-8000-0000000000b2', 'wifi', 'B', 'Synthetic B body', 'guest', true);
insert into app.share_links (id, secret_hmac, property_id) values
  ('pgtapLinkA0000000001', '\x0102', '7a000000-0000-4000-8000-0000000000a2'),
  ('pgtapLinkB0000000002', '\x0102', '7a000000-0000-4000-8000-0000000000b2');
insert into app.share_links (id, property_id, enabled, disabled_at)
  values ('pgtapLinkA0000000003', '7a000000-0000-4000-8000-0000000000a2', false, now());

-- Link actions join the audit vocabulary; unknown names stay rejected.
create temp table probe_audit_link on commit drop as
  with ins as (
    insert into app.audit_events (actor_id, action)
      values
        ('7a000000-0000-4000-8000-0000000000a1', 'link_created'),
        ('7a000000-0000-4000-8000-0000000000a1', 'link_rotated'),
        ('7a000000-0000-4000-8000-0000000000a1', 'link_disabled')
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
    insert into app.audit_events (actor_id, action) values ('7a000000-0000-4000-8000-0000000000a1', 'link_deleted');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_audit_bogus (blocked, err_state) values (blocked, err_state);
end $$;

-- State invariants and the single-active-link rule.
create temp table probe_state_enabled_disabled (blocked boolean not null, err_state text) on commit drop;
create temp table probe_state_enabled_nodigest (blocked boolean not null, err_state text) on commit drop;
create temp table probe_state_disabled_nodate (blocked boolean not null, err_state text) on commit drop;
create temp table probe_second_enabled (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean;
  err_state text;
begin
  begin
    blocked := false; err_state := 'none';
    insert into app.share_links (id, secret_hmac, property_id, enabled, disabled_at)
      values ('pgtapProbeState0000001', '\x0102', '7a000000-0000-4000-8000-0000000000a2', true, now());
  exception when others then
    blocked := true; get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_state_enabled_disabled (blocked, err_state) values (blocked, err_state);

  begin
    blocked := false; err_state := 'none';
    insert into app.share_links (id, property_id, enabled) values ('pgtapProbeState0000002', '7a000000-0000-4000-8000-0000000000a2', true);
  exception when others then
    blocked := true; get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_state_enabled_nodigest (blocked, err_state) values (blocked, err_state);

  begin
    blocked := false; err_state := 'none';
    insert into app.share_links (id, secret_hmac, property_id, enabled) values ('pgtapProbeState0000003', '\x0102', '7a000000-0000-4000-8000-0000000000a2', false);
  exception when others then
    blocked := true; get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_state_disabled_nodate (blocked, err_state) values (blocked, err_state);

  begin
    blocked := false; err_state := 'none';
    insert into app.share_links (id, secret_hmac, property_id) values ('pgtapProbeState0000004', '\x0102', '7a000000-0000-4000-8000-0000000000a2');
  exception when others then
    blocked := true; get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_second_enabled (blocked, err_state) values (blocked, err_state);
end $$;

-- Link context: a link id alone exposes exactly its own link, property, and guest-published prose.
set local role app_runtime;
select set_config('app.link_id', 'pgtapLinkA0000000001', true);
select set_config('app.link_property_id', '7a000000-0000-4000-8000-0000000000a2', true);
create temp table probe_link_rows on commit drop as select count(*)::bigint as n from app.share_links;
create temp table probe_link_property on commit drop as select id from app.properties;
create temp table probe_link_sections on commit drop as
  select count(*)::bigint as n, min(title) as title from app.guide_sections;
create temp table probe_link_session_in on commit drop as
  with ins as (
    insert into app.guest_sessions (session_hash, share_link_id, expires_at)
      values ('\x0a0b', 'pgtapLinkA0000000001', now() + interval '1 hour')
      returning 1 as n
  )
  select count(*)::bigint as n from ins;
create temp table probe_link_session_out (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guest_sessions (session_hash, share_link_id, expires_at)
      values ('\x0c0d', 'pgtapLinkB0000000002', now() + interval '1 hour');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_link_session_out (blocked, err_state) values (blocked, err_state);
end $$;
create temp table probe_link_sessions on commit drop as select count(*)::bigint as n from app.guest_sessions;

-- Pointing the context at an unpublished property of the same host exposes nothing.
select set_config('app.link_property_id', '7a000000-0000-4000-8000-0000000000a6', true);
create temp table probe_unpublished_property on commit drop as select count(*)::bigint as n from app.properties;
create temp table probe_unpublished_sections on commit drop as select count(*)::bigint as n from app.guide_sections;

reset role;
select set_config('app.link_id', '', true);
select set_config('app.link_property_id', '', true);
set local role app_runtime;
create temp table probe_no_context on commit drop as select count(*)::bigint as n from app.share_links;
reset role;

-- Owner context: own links (including disabled metadata), no cross-owner writes, atomic disable.
set local role app_runtime;
select set_config('app.owner_id', '7a000000-0000-4000-8000-0000000000a1', true);
create temp table probe_owner_links on commit drop as select count(*)::bigint as n from app.share_links;
create temp table probe_owner_cross (changed bigint not null) on commit drop;
do $$
declare
  changed bigint;
begin
  with updated as (
    update app.share_links set enabled = false, disabled_at = now(), secret_hmac = null
    where id = 'pgtapLinkB0000000002' returning 1
  )
  select count(*)::bigint into changed from updated;
  insert into probe_owner_cross (changed) values (changed);
end $$;
create temp table probe_owner_disable (changed bigint not null, sessions bigint not null) on commit drop;
do $$
declare
  changed bigint;
  sessions bigint;
begin
  with updated as (
    update app.share_links set enabled = false, disabled_at = now(), secret_hmac = null
    where property_id = '7a000000-0000-4000-8000-0000000000a2' and enabled returning 1
  )
  select count(*)::bigint into changed from updated;
  with deleted as (
    delete from app.guest_sessions where share_link_id = 'pgtapLinkA0000000001' returning 1
  )
  select count(*)::bigint into sessions from deleted;
  insert into probe_owner_disable (changed, sessions) values (changed, sessions);
end $$;
reset role;
select set_config('app.owner_id', '', true);

set local role app_runtime;
select set_config('app.link_id', 'pgtapLinkA0000000001', true);
create temp table probe_disabled_link on commit drop as select count(*)::bigint as n from app.share_links;
reset role;
select set_config('app.link_id', '', true);

-- Deleting a link cascades to its sessions.
insert into app.guest_sessions (session_hash, share_link_id, expires_at)
  values ('\x0e0f', 'pgtapLinkB0000000002', now() + interval '1 hour');
delete from app.share_links where id = 'pgtapLinkB0000000002';
create temp table probe_cascade on commit drop as
  select count(*)::bigint as n from app.guest_sessions where share_link_id = 'pgtapLinkB0000000002';

select is((select n from probe_audit_link), 3::bigint, 'link lifecycle actions are valid audit actions');
select is((select blocked from probe_audit_bogus), true, 'unknown link audit actions stay rejected');
select is((select err_state from probe_state_enabled_disabled), '23514', 'an enabled link cannot carry a disabled timestamp');
select is((select err_state from probe_state_enabled_nodigest), '23514', 'an enabled link requires a stored digest');
select is((select err_state from probe_state_disabled_nodate), '23514', 'a disabled link must record its disabled timestamp');
select is((select err_state from probe_second_enabled), '23505', 'a property can have only one enabled link');
select is((select n from probe_link_rows), 1::bigint, 'link context sees only its own link row');
select is((select id::text from probe_link_property), '7a000000-0000-4000-8000-0000000000a2', 'link context resolves its own property');
select is((select n from probe_link_sections), 1::bigint, 'link context sees only guest-published sections');
select is((select title from probe_link_sections), 'Guest Wi-Fi', 'link context sees the published section itself');
select is((select n from probe_link_session_in), 1::bigint, 'link context creates its own guest session');
select is((select blocked from probe_link_session_out), true, 'link context cannot create another link session');
select is((select err_state from probe_link_session_out), '42501', 'foreign-link session insert fails with an RLS violation');
select is((select n from probe_link_sessions), 1::bigint, 'link context sees only its own sessions');
select is((select n from probe_unpublished_property), 0::bigint, 'an unpublished property is invisible to guest reads');
select is((select n from probe_unpublished_sections), 0::bigint, 'unpublished sections are invisible to guest reads');
select is((select n from probe_no_context), 0::bigint, 'without link context no link rows are visible');
select is((select n from probe_owner_links), 2::bigint, 'owner context sees its own links including disabled metadata');
select is((select changed from probe_owner_cross), 0::bigint, 'owner context cannot disable another host link');
select is((select changed from probe_owner_disable), 1::bigint, 'owner context disables its own link');
select is((select sessions from probe_owner_disable), 1::bigint, 'owner disable deletes the link sessions');
select is((select n from probe_disabled_link), 0::bigint, 'a disabled link is invisible to guest reads');
select is((select n from probe_cascade), 0::bigint, 'deleting a link cascades to its sessions');

select * from finish();
rollback;
