-- Guest features 4a: property credentials are owner-only. Neither another host, a guest link
-- context on the published property, nor the Data API roles can read them.
begin;

create extension if not exists pgtap;

select plan(12);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

insert into auth.users (id, email) values
  ('4a4a0000-0000-4000-8000-0000000000a1', 'pgtap-4a-a@example.test'),
  ('4a4a0000-0000-4000-8000-0000000000b1', 'pgtap-4a-b@example.test');
insert into app.properties (id, owner_id, display_name, published, checkin_time, checkout_time) values
  ('4a4a0000-0000-4000-8000-0000000000a2', '4a4a0000-0000-4000-8000-0000000000a1', 'Essentials A', true, '15:00', '10:00'),
  ('4a4a0000-0000-4000-8000-0000000000b2', '4a4a0000-0000-4000-8000-0000000000b1', 'Essentials B', true, null, null);
insert into app.property_credentials (property_id, wifi_name, wifi_password, keybox_code) values
  ('4a4a0000-0000-4000-8000-0000000000a2', 'Net A', 'pass-a', '1111');

select is((select relforcerowsecurity from pg_class where oid = 'app.property_credentials'::regclass), true, 'credentials force RLS');
select ok(not has_table_privilege('anon', 'app.property_credentials', 'select'), 'anon cannot select credentials');
select ok(not has_table_privilege('authenticated', 'app.property_credentials', 'select'), 'authenticated cannot select credentials');
select throws_ok($$insert into app.property_credentials (property_id, keybox_code) values ('4a4a0000-0000-4000-8000-0000000000b2', '')$$, '23514', null, 'an empty code is stored as null, not as an empty string');
select throws_ok($$insert into app.property_credentials (property_id, wifi_password) values ('4a4a0000-0000-4000-8000-0000000000b2', repeat('x', 129))$$, '23514', null, 'oversized passwords are refused');

set local role app_runtime;
select set_config('app.owner_id', '4a4a0000-0000-4000-8000-0000000000a1', true);
create temp table probe_owner on commit drop as
  select (select count(*)::integer from app.property_credentials) as n,
    (select wifi_password from app.property_credentials where property_id = '4a4a0000-0000-4000-8000-0000000000a2') as pass;
update app.property_credentials set keybox_code = '2222' where property_id = '4a4a0000-0000-4000-8000-0000000000a2';
select set_config('app.owner_id', '4a4a0000-0000-4000-8000-0000000000b1', true);
create temp table probe_foreign on commit drop as
  with updated as (
    update app.property_credentials set keybox_code = '9999' where property_id = '4a4a0000-0000-4000-8000-0000000000a2' returning 1
  )
  select (select count(*)::integer from app.property_credentials) as n, (select count(*)::integer from updated) as updated;
select set_config('app.owner_id', '', true);
select set_config('app.link_id', 'pgtap4aLink0000001', true);
select set_config('app.link_property_id', '4a4a0000-0000-4000-8000-0000000000a2', true);
create temp table probe_guest on commit drop as
  select (select count(*)::integer from app.property_credentials) as n,
    (select count(*)::integer from app.properties) as properties;
reset role;
select set_config('app.link_id', '', true);
select set_config('app.link_property_id', '', true);

select is((select n from probe_owner), 1, 'the owner reads its own credentials');
select is((select pass from probe_owner), 'pass-a', 'the owner reads the stored password');
select is((select keybox_code from app.property_credentials where property_id = '4a4a0000-0000-4000-8000-0000000000a2'), '2222', 'the owner can change the code');
select is((select n from probe_foreign), 0, 'another host reads no credentials');
select is((select updated from probe_foreign), 0, 'another host cannot change the code');
select is((select properties from probe_guest), 1, 'the guest link context sees its published property');
select is((select n from probe_guest), 0, 'a guest context without a live link reads no credentials');

select * from finish();
rollback;
