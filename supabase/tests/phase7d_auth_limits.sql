-- Phase 7d: OTP send windows live in their own tenant-free table that only the runtime can write
-- and the retention cleanup purges with the other rate windows.
begin;

create extension if not exists pgtap;

select plan(8);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

select is((select relforcerowsecurity from pg_class where oid = 'app.auth_rate_limits'::regclass), true, 'auth rate windows force RLS');
select is((select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner where c.oid = 'app.auth_rate_limits'::regclass), 'app_migrator', 'the table is owned by the migration role');
select is(has_table_privilege('anon', 'app.auth_rate_limits', 'select'), false, 'anon cannot read auth rate windows');
select is(has_table_privilege('authenticated', 'app.auth_rate_limits', 'select'), false, 'authenticated cannot read auth rate windows');

set local role app_runtime;
insert into app.auth_rate_limits (key_hash, window_start) values
  ('\x31', '2026-10-18T23:45:00Z'),
  ('\x32', '2026-10-19T00:00:00Z');
update app.auth_rate_limits set count = count + 1 where key_hash = '\x32';
reset role;
select is((select count from app.auth_rate_limits where key_hash = '\x32'), 2, 'the runtime role can bump a window');

set local role app_migrator;
create temp table probe_auth_cleanup on commit drop as select app.retention_cleanup('2026-10-19T12:00:00Z'::timestamptz) as result;
reset role;

select is((select (result->>'auth_rate_limits')::integer from probe_auth_cleanup), 1, 'auth windows before the boundary UTC day are deleted');
select is((select count(*)::integer from app.auth_rate_limits where key_hash = '\x31'), 0, 'the previous UTC day auth window is gone');
select is((select count(*)::integer from app.auth_rate_limits where key_hash = '\x32'), 1, 'the current UTC day auth window is kept');

select * from finish();
rollback;
