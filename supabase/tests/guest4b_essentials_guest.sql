-- Guest features 4b: a live link reads only its own published property's credentials; another
-- property, a disabled or rotated link, and an unpublished property read nothing.
begin;

create extension if not exists pgtap;

select plan(4);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

insert into auth.users (id, email) values
  ('4b4b0000-0000-4000-8000-0000000000a1', 'pgtap-4b-a@example.test'),
  ('4b4b0000-0000-4000-8000-0000000000b1', 'pgtap-4b-b@example.test');
insert into app.properties (id, owner_id, display_name, published) values
  ('4b4b0000-0000-4000-8000-0000000000a2', '4b4b0000-0000-4000-8000-0000000000a1', 'Guest A', true),
  ('4b4b0000-0000-4000-8000-0000000000b2', '4b4b0000-0000-4000-8000-0000000000b1', 'Guest B', true),
  ('4b4b0000-0000-4000-8000-0000000000c2', '4b4b0000-0000-4000-8000-0000000000a1', 'Guest C', false);
insert into app.property_credentials (property_id, wifi_password, keybox_code) values
  ('4b4b0000-0000-4000-8000-0000000000a2', 'pass-a', '1111'),
  ('4b4b0000-0000-4000-8000-0000000000b2', 'pass-b', '2222'),
  ('4b4b0000-0000-4000-8000-0000000000c2', 'pass-c', '3333');
insert into app.share_links (id, secret_hmac, property_id, enabled) values
  ('pgtap4bLinkA0000001', '\x0102', '4b4b0000-0000-4000-8000-0000000000a2', true),
  ('pgtap4bLinkOld00001', null, '4b4b0000-0000-4000-8000-0000000000a2', false),
  ('pgtap4bLinkC0000001', '\x0102', '4b4b0000-0000-4000-8000-0000000000c2', true);

create temp table probes (name text, n integer) on commit drop;
grant insert on probes to app_runtime;

create function pg_temp.probe(p_name text, p_link text, p_property uuid) returns void language plpgsql as $$
begin
  perform set_config('app.link_id', p_link, true);
  perform set_config('app.link_property_id', p_property::text, true);
  set local role app_runtime;
  insert into probes select p_name, count(*)::integer from app.property_credentials;
  reset role;
end $$;

select pg_temp.probe('own', 'pgtap4bLinkA0000001', '4b4b0000-0000-4000-8000-0000000000a2');
select pg_temp.probe('cross', 'pgtap4bLinkA0000001', '4b4b0000-0000-4000-8000-0000000000b2');
select pg_temp.probe('disabled', 'pgtap4bLinkOld00001', '4b4b0000-0000-4000-8000-0000000000a2');
select pg_temp.probe('unpublished', 'pgtap4bLinkC0000001', '4b4b0000-0000-4000-8000-0000000000c2');

select is((select n from probes where name = 'own'), 1, 'a live link reads its own property credentials');
select is((select n from probes where name = 'cross'), 0, 'a link for property A cannot read property B credentials');
select is((select n from probes where name = 'disabled'), 0, 'a disabled or rotated link reads nothing');
select is((select n from probes where name = 'unpublished'), 0, 'an unpublished property serves no credentials');

select * from finish();
rollback;
