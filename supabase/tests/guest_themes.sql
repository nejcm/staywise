-- Guest themes: new properties default to the house theme and only preset keys are stored.
begin;

create extension if not exists pgtap;

select plan(3);

insert into auth.users (id, email) values ('7e7e0000-0000-4000-8000-0000000000a1', 'pgtap-theme-a@example.test');
insert into app.properties (id, owner_id, display_name) values
  ('7e7e0000-0000-4000-8000-0000000000a2', '7e7e0000-0000-4000-8000-0000000000a1', 'Theme A');

select is((select theme from app.properties where id = '7e7e0000-0000-4000-8000-0000000000a2'), 'staywise', 'theme defaults to staywise');
select lives_ok($$update app.properties set theme = 'alpine' where id = '7e7e0000-0000-4000-8000-0000000000a2'$$, 'a preset key is accepted');
select throws_ok($$update app.properties set theme = 'neon' where id = '7e7e0000-0000-4000-8000-0000000000a2'$$, '23514', null, 'an unknown key is rejected');

select * from finish();
rollback;
