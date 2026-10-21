-- Host settings are owner-only: another host and the Data API roles can neither read nor write them.
begin;

create extension if not exists pgtap;

select plan(12);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

insert into auth.users (id, email) values
  ('5e5e0000-0000-4000-8000-0000000000a1', 'pgtap-settings-a@example.test'),
  ('5e5e0000-0000-4000-8000-0000000000b1', 'pgtap-settings-b@example.test');
insert into app.host_settings (owner_id, theme, timezone) values
  ('5e5e0000-0000-4000-8000-0000000000a1', 'alpine', 'Europe/Ljubljana');

select is((select relforcerowsecurity from pg_class where oid = 'app.host_settings'::regclass), true, 'host settings force RLS');
select ok(not has_table_privilege('anon', 'app.host_settings', 'select'), 'anon cannot select host settings');
select ok(not has_table_privilege('authenticated', 'app.host_settings', 'select'), 'authenticated cannot select host settings');
select throws_ok($$insert into app.host_settings (owner_id, theme) values ('5e5e0000-0000-4000-8000-0000000000b1', 'neon')$$, '23514', null, 'an unknown theme is rejected');
select throws_ok($$insert into app.host_settings (owner_id, enabled_locales) values ('5e5e0000-0000-4000-8000-0000000000b1', '{xx}')$$, '23514', null, 'an unapproved locale is rejected');
select throws_ok($$insert into app.host_settings (owner_id, answer_from) values ('5e5e0000-0000-4000-8000-0000000000b1', '09:00')$$, '23514', null, 'answering hours must be paired');

set local role app_runtime;
select set_config('app.owner_id', '5e5e0000-0000-4000-8000-0000000000a1', true);
create temp table probe_owner on commit drop as
  select (select count(*)::integer from app.host_settings) as n, (select theme from app.host_settings) as theme;
update app.host_settings set theme = 'coast' where owner_id = '5e5e0000-0000-4000-8000-0000000000a1';
select set_config('app.owner_id', '5e5e0000-0000-4000-8000-0000000000b1', true);
create temp table probe_foreign on commit drop as
  with updated as (
    update app.host_settings set theme = 'classic' where owner_id = '5e5e0000-0000-4000-8000-0000000000a1' returning 1
  )
  select (select count(*)::integer from app.host_settings) as n, (select count(*)::integer from updated) as updated;
do $$ begin
  insert into app.host_settings (owner_id) values ('5e5e0000-0000-4000-8000-0000000000a1');
  perform set_config('test.foreign_insert', 'inserted', true);
exception when others then
  perform set_config('test.foreign_insert', sqlstate, true);
end $$;
insert into app.host_settings (owner_id) values ('5e5e0000-0000-4000-8000-0000000000b1');
reset role;

select is(current_setting('test.foreign_insert'), '42501', 'another host cannot insert a row for someone else');
select ok(exists (select 1 from app.host_settings where owner_id = '5e5e0000-0000-4000-8000-0000000000b1'), 'a host creates its own row');

select is((select n from probe_owner), 1, 'the owner reads its own settings');
select is((select theme from app.host_settings where owner_id = '5e5e0000-0000-4000-8000-0000000000a1'), 'coast', 'the owner can change its settings');
select is((select n from probe_foreign), 0, 'another host reads no settings');
select is((select updated from probe_foreign), 0, 'another host cannot change the settings');

select * from finish();
rollback;
