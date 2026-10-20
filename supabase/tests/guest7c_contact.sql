-- Guest features 7c: E.164 phone check and link-scoped read of phone and hours.
begin;

create extension if not exists pgtap;

select plan(5);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

insert into auth.users (id, email) values ('7c7c0000-0000-4000-8000-0000000000a1', 'pgtap-7c-a@example.test');
insert into app.properties (id, owner_id, display_name, published, contact_phone, answer_from, answer_to) values
  ('7c7c0000-0000-4000-8000-0000000000a2', '7c7c0000-0000-4000-8000-0000000000a1', 'Contact A', true, '+38641234567', '22:00', '02:00');
insert into app.share_links (id, secret_hmac, property_id, enabled) values
  ('pgtap7cLinkA0000001', '\x0102', '7c7c0000-0000-4000-8000-0000000000a2', true);

select throws_ok($$update app.properties set contact_phone = '041 234 567' where id = '7c7c0000-0000-4000-8000-0000000000a2'$$, '23514', null, 'non-E.164 phone rejected');
select throws_ok($$update app.properties set contact_phone = '+0123456789' where id = '7c7c0000-0000-4000-8000-0000000000a2'$$, '23514', null, 'leading zero country code rejected');
select throws_ok($$update app.properties set answer_to = null where id = '7c7c0000-0000-4000-8000-0000000000a2'$$, '23514', null, 'answering hours must be paired');
select lives_ok($$update app.properties set contact_phone = null where id = '7c7c0000-0000-4000-8000-0000000000a2'$$, 'phone can be cleared');
update app.properties set contact_phone = '+38641234567' where id = '7c7c0000-0000-4000-8000-0000000000a2';

create temp table probes (phone text, hours text) on commit drop;
grant insert on probes to app_runtime;
select set_config('app.link_id', 'pgtap7cLinkA0000001', true);
select set_config('app.link_property_id', '7c7c0000-0000-4000-8000-0000000000a2', true);
set local role app_runtime;
insert into probes select contact_phone, answer_from::text || '-' || answer_to::text from app.properties;
reset role;
select results_eq('select phone, hours from probes', $$values ('+38641234567', '22:00:00-02:00:00')$$, 'a live link reads its phone and hours');

select * from finish();
rollback;
