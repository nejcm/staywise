-- Guest features 6 / 7b: address length check, link read, UTC default.
begin;

create extension if not exists pgtap;

select plan(5);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

insert into auth.users (id, email) values ('6a6a0000-0000-4000-8000-0000000000a1', 'pgtap-6-a@example.test');
insert into app.properties (id, owner_id, display_name, published, address) values
  ('6a6a0000-0000-4000-8000-0000000000a2', '6a6a0000-0000-4000-8000-0000000000a1', 'Address A', true, 'Cesta svobode 12, Bled');
insert into app.share_links (id, secret_hmac, property_id, enabled) values
  ('pgtap6LinkA00000001', '\x0102', '6a6a0000-0000-4000-8000-0000000000a2', true);

select is((select timezone from app.properties where id = '6a6a0000-0000-4000-8000-0000000000a2'), 'UTC', 'time zone defaults to UTC');
select throws_ok($$update app.properties set address = '' where id = '6a6a0000-0000-4000-8000-0000000000a2'$$, '23514', null, 'empty address rejected');
select throws_ok($$update app.properties set address = repeat('x', 201) where id = '6a6a0000-0000-4000-8000-0000000000a2'$$, '23514', null, 'address over 200 characters rejected');
select lives_ok($$update app.properties set address = null where id = '6a6a0000-0000-4000-8000-0000000000a2'$$, 'address can be cleared');
update app.properties set address = 'Cesta svobode 12, Bled' where id = '6a6a0000-0000-4000-8000-0000000000a2';

create temp table probes (address text) on commit drop;
grant insert on probes to app_runtime;
select set_config('app.link_id', 'pgtap6LinkA00000001', true);
select set_config('app.link_property_id', '6a6a0000-0000-4000-8000-0000000000a2', true);
set local role app_runtime;
insert into probes select address from app.properties;
reset role;
select is((select address from probes), 'Cesta svobode 12, Bled', 'a live link reads its property address');

select * from finish();
rollback;
