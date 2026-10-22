-- Policy hardening: guest property and section reads recheck the live link, guest sessions cannot be updated
-- from a link context, a revoked agent grant stays revoked, and fingerprint windows are runtime-only.
-- Synthetic; rolls back.
begin;

create extension if not exists pgtap;

select plan(29);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;
do $$ begin execute format('grant app_migrator to %I with set true', current_user); end $$;

insert into auth.users (id, email) values
  ('9a9a0000-0000-4000-8000-0000000000a1', 'pgtap-hard-a@example.test'),
  ('9a9a0000-0000-4000-8000-0000000000b1', 'pgtap-hard-b@example.test');
insert into app.properties (id, owner_id, display_name, published) values
  ('9a9a0000-0000-4000-8000-0000000000a2', '9a9a0000-0000-4000-8000-0000000000a1', 'Hardening A', true),
  ('9a9a0000-0000-4000-8000-0000000000b2', '9a9a0000-0000-4000-8000-0000000000b1', 'Hardening B', true),
  ('9a9a0000-0000-4000-8000-0000000000c2', '9a9a0000-0000-4000-8000-0000000000a1', 'Hardening C', true);
insert into app.guide_sections (id, property_id, category, title, body, visibility, published) values
  ('9a9a0000-0000-4000-8000-0000000000a3', '9a9a0000-0000-4000-8000-0000000000a2', 'wifi', 'Guest Wi-Fi', 'Synthetic guest body', 'guest', true),
  ('9a9a0000-0000-4000-8000-0000000000c3', '9a9a0000-0000-4000-8000-0000000000c2', 'wifi', 'Guest Wi-Fi C', 'Synthetic guest body C', 'guest', true);
insert into app.share_links (id, secret_hmac, property_id) values
  ('pgtapHardLinkA000001', '\x0102', '9a9a0000-0000-4000-8000-0000000000a2'),
  ('pgtapHardLinkB000001', '\x0102', '9a9a0000-0000-4000-8000-0000000000b2');
-- C has only a disabled link, as after a disable or a rotation's old row.
insert into app.share_links (id, property_id, enabled, disabled_at) values
  ('pgtapHardLinkC000001', '9a9a0000-0000-4000-8000-0000000000c2', false, now());
insert into app.guest_sessions (session_hash, share_link_id, expires_at) values
  ('\x9a01', 'pgtapHardLinkA000001', now() + interval '1 hour'),
  ('\x9a02', 'pgtapHardLinkB000001', now() + interval '1 hour');
insert into app.agent_grants (id, owner_id, kind, name, token_hash, scopes, expires_at, revoked_at) values
  ('9a9a0000-0000-4000-8000-0000000000d1', '9a9a0000-0000-4000-8000-0000000000a1', 'pat', 'Revoked', sha256('hard-d1'), '{read}', now() + interval '1 day', now() - interval '1 hour'),
  ('9a9a0000-0000-4000-8000-0000000000d2', '9a9a0000-0000-4000-8000-0000000000a1', 'pat', 'Live', sha256('hard-d2'), '{read}', now() + interval '1 day', null);

create temp table probes (label text, name text, n integer) on commit drop;
grant insert on probes to app_runtime;

-- Guest reads with a property context that the link id does not back: the property and its sections stay hidden.
create function pg_temp.guest_probe(p_label text, p_link text, p_property uuid) returns void language plpgsql as $$
begin
  perform set_config('app.link_id', coalesce(p_link, ''), true);
  perform set_config('app.link_property_id', p_property::text, true);
  set local role app_runtime;
  insert into probes select p_label, 'properties', count(*)::integer from app.properties;
  insert into probes select p_label, 'sections', count(*)::integer from app.guide_sections;
  reset role;
  perform set_config('app.link_id', '', true);
  perform set_config('app.link_property_id', '', true);
end $$;

select pg_temp.guest_probe('live', 'pgtapHardLinkA000001', '9a9a0000-0000-4000-8000-0000000000a2');
select pg_temp.guest_probe('no link', null, '9a9a0000-0000-4000-8000-0000000000a2');
select pg_temp.guest_probe('unknown link', 'pgtapHardLinkZ000001', '9a9a0000-0000-4000-8000-0000000000a2');
select pg_temp.guest_probe('foreign link', 'pgtapHardLinkB000001', '9a9a0000-0000-4000-8000-0000000000a2');
select pg_temp.guest_probe('disabled link', 'pgtapHardLinkC000001', '9a9a0000-0000-4000-8000-0000000000c2');

select is((select n from probes where label = 'live' and name = 'properties'), 1, 'a live link reads its published property');
select is((select n from probes where label = 'live' and name = 'sections'), 1, 'a live link reads its guest sections');
select is((select n from probes where label = 'no link' and name = 'properties'), 0, 'a property context without a link id reads no property');
select is((select n from probes where label = 'no link' and name = 'sections'), 0, 'a property context without a link id reads no section');
select is((select n from probes where label = 'unknown link' and name = 'properties'), 0, 'an unknown link id reads no property');
select is((select n from probes where label = 'unknown link' and name = 'sections'), 0, 'an unknown link id reads no section');
select is((select n from probes where label = 'foreign link' and name = 'properties'), 0, 'another property link reads no property');
select is((select n from probes where label = 'foreign link' and name = 'sections'), 0, 'another property link reads no section');
select is((select n from probes where label = 'disabled link' and name = 'properties'), 0, 'a disabled link reads no property');
select is((select n from probes where label = 'disabled link' and name = 'sections'), 0, 'a disabled link reads no section');
select is(has_function_privilege('app_runtime', 'app.current_link_live(uuid)', 'execute'), true, 'the runtime can evaluate the link recheck');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'app.current_link_live(uuid)'::regprocedure), 'the link recheck is a definer with an empty search path');

-- Guest sessions: select, insert, and delete only; an update from the link context changes nothing.
create function pg_temp.session_probe() returns void language plpgsql as $$
declare
  v integer;
begin
  perform set_config('app.link_id', 'pgtapHardLinkA000001', true);
  set local role app_runtime;
  select count(*)::integer into v from app.guest_sessions;
  insert into probes values ('session', 'select', v);
  update app.guest_sessions set expires_at = now() + interval '1 year';
  get diagnostics v = row_count;
  insert into probes values ('session', 'update', v);
  insert into app.guest_sessions (session_hash, share_link_id, expires_at)
    values ('\x9a03', 'pgtapHardLinkA000001', now() + interval '1 hour');
  get diagnostics v = row_count;
  insert into probes values ('session', 'insert', v);
  delete from app.guest_sessions where session_hash = '\x9a03';
  get diagnostics v = row_count;
  insert into probes values ('session', 'delete', v);
  delete from app.guest_sessions where share_link_id = 'pgtapHardLinkB000001';
  get diagnostics v = row_count;
  insert into probes values ('session', 'delete foreign', v);
  reset role;
  perform set_config('app.link_id', '', true);
end $$;
select pg_temp.session_probe();

select is((select n from probes where label = 'session' and name = 'select'), 1, 'a link context reads its own session');
select is((select n from probes where label = 'session' and name = 'update'), 0, 'a link context cannot extend a session');
select is((select expires_at < now() + interval '2 hours' from app.guest_sessions where session_hash = '\x9a01'), true, 'the session expiry is unchanged');
select is((select n from probes where label = 'session' and name = 'insert'), 1, 'a link context still creates its own session');
select is((select n from probes where label = 'session' and name = 'delete'), 1, 'a link context still deletes its own session');
select is((select n from probes where label = 'session' and name = 'delete foreign'), 0, 'a link context cannot delete another link session');
select is(
  (select array_agg(cmd::text order by cmd) from pg_policies where schemaname = 'app' and tablename = 'guest_sessions' and policyname like 'guest_sessions_guest%'),
  array['DELETE', 'INSERT', 'SELECT'],
  'the guest session policies cover select, insert, and delete only'
);

-- Agent grants: revoking a live grant works, a revocation can never be cleared or moved.
create function pg_temp.grant_state(p_sql text) returns text language plpgsql as $$
declare
  v_state text := 'ok';
begin
  perform set_config('app.owner_id', '9a9a0000-0000-4000-8000-0000000000a1', true);
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

select is(pg_temp.grant_state($$update app.agent_grants set revoked_at = null where id = '9a9a0000-0000-4000-8000-0000000000d1'$$), '23514', 'the runtime cannot un-revoke a grant');
select is(pg_temp.grant_state($$update app.agent_grants set revoked_at = now() + interval '1 day' where id = '9a9a0000-0000-4000-8000-0000000000d1'$$), '23514', 'the runtime cannot move a revocation');
select is(pg_temp.grant_state($$update app.agent_grants set last_used_at = now() where id = '9a9a0000-0000-4000-8000-0000000000d1'$$), 'ok', 'other columns of a revoked grant still update');
select is(pg_temp.grant_state($$update app.agent_grants set revoked_at = now() where id = '9a9a0000-0000-4000-8000-0000000000d2'$$), 'ok', 'a live grant can be revoked');
select is((select revoked_at is not null from app.agent_grants where id = '9a9a0000-0000-4000-8000-0000000000d2'), true, 'the revocation is stored');
select throws_ok(
  $$update app.agent_grants set revoked_at = null where id = '9a9a0000-0000-4000-8000-0000000000d1'$$,
  '23514', null, 'no role can un-revoke a grant');

-- Fingerprint windows: the runtime and the retention role only.
insert into app.rate_limits (property_id, key_hash, window_start) values
  ('9a9a0000-0000-4000-8000-0000000000a2', '\x9a11', date_trunc('day', now()));
select is(
  (select roles::text[] from pg_policies where schemaname = 'app' and tablename = 'rate_limits' and policyname = 'rate_limits_runtime'),
  array['app_runtime'],
  'rate_limits_runtime is limited to the runtime role'
);
set local role app_runtime;
create temp table probe_rate_runtime on commit drop as select count(*)::integer as n from app.rate_limits where key_hash = '\x9a11';
reset role;
select is((select n from probe_rate_runtime), 1, 'the runtime reads rate windows');
set local role app_migrator;
create temp table probe_rate_migrator on commit drop as select count(*)::integer as n from app.rate_limits where key_hash = '\x9a11';
reset role;
select is((select n from probe_rate_migrator), 1, 'the retention role still reads rate windows to purge them');
select is(
  (select array_agg(cmd::text order by cmd) from pg_policies where schemaname = 'app' and tablename = 'rate_limits' and 'app_migrator' = any (roles)),
  array['DELETE', 'SELECT'],
  'the retention role may only read and delete rate windows'
);

select * from finish();
rollback;
