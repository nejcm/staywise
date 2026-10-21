-- Hero images (ADR 0005): private limited bucket, owner-only writes, live-link guest reads, queued deletions.
begin;

create extension if not exists pgtap;

select plan(21);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

select is(
  (select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'guide-images'),
  row(false, 1048576::bigint, '{image/jpeg}'::text[])::text,
  'the guide-images bucket is private, 1 MiB, JPEG only'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage'
    and (coalesce(qual, '') like '%guide-images%' or coalesce(with_check, '') like '%guide-images%')),
  0,
  'no storage policy mentions the guide-images bucket'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and roles && array['anon', 'authenticated', 'public']::name[]),
  0,
  'no storage.objects policy grants anon, authenticated, or public'
);

insert into auth.users (id, email) values
  ('1e1e0000-0000-4000-8000-0000000000a1', 'pgtap-hero-a@example.test'),
  ('1e1e0000-0000-4000-8000-0000000000b1', 'pgtap-hero-b@example.test');
insert into app.properties (id, owner_id, display_name, published) values
  ('1e1e0000-0000-4000-8000-0000000000a2', '1e1e0000-0000-4000-8000-0000000000a1', 'Hero A', true),
  ('1e1e0000-0000-4000-8000-0000000000b2', '1e1e0000-0000-4000-8000-0000000000b1', 'Hero B', true),
  ('1e1e0000-0000-4000-8000-0000000000c2', '1e1e0000-0000-4000-8000-0000000000a1', 'Hero C', false);
insert into app.property_images (property_id, object_path, alt, width, height, bytes) values
  ('1e1e0000-0000-4000-8000-0000000000b2', '1e1e0000-0000-4000-8000-0000000000b2/b.jpg', 'B', 1600, 1067, 1000),
  ('1e1e0000-0000-4000-8000-0000000000c2', '1e1e0000-0000-4000-8000-0000000000c2/c.jpg', 'C', 1600, 1067, 1000);
insert into app.share_links (id, secret_hmac, property_id, enabled) values
  ('pgtapHeroLinkA00001', '\x0102', '1e1e0000-0000-4000-8000-0000000000a2', true),
  ('pgtapHeroLinkOld001', null, '1e1e0000-0000-4000-8000-0000000000a2', false),
  ('pgtapHeroLinkB00001', '\x0102', '1e1e0000-0000-4000-8000-0000000000b2', true),
  ('pgtapHeroLinkC00001', '\x0102', '1e1e0000-0000-4000-8000-0000000000c2', true);

create temp table probes (name text, n integer) on commit drop;
grant insert on probes to app_runtime;

create function pg_temp.guest(p_name text, p_link text, p_property uuid) returns void language plpgsql as $$
begin
  perform set_config('app.link_id', p_link, true);
  perform set_config('app.link_property_id', p_property::text, true);
  set local role app_runtime;
  insert into probes select p_name, count(*)::integer from app.property_images;
  reset role;
  perform set_config('app.link_id', '', true);
  perform set_config('app.link_property_id', '', true);
end $$;

-- Runs one statement as the runtime role in an owner context; records 1 on success, 0 on an RLS denial.
create function pg_temp.as_owner(p_name text, p_owner uuid, p_sql text) returns void language plpgsql as $$
begin
  perform set_config('app.owner_id', p_owner::text, true);
  set local role app_runtime;
  begin
    execute p_sql;
    insert into probes values (p_name, 1);
  exception when insufficient_privilege then
    insert into probes values (p_name, 0);
  end;
  reset role;
  perform set_config('app.owner_id', '', true);
end $$;

select pg_temp.as_owner('insert own', '1e1e0000-0000-4000-8000-0000000000a1',
  $$insert into app.property_images (property_id, object_path, alt, width, height, bytes)
    values ('1e1e0000-0000-4000-8000-0000000000a2', '1e1e0000-0000-4000-8000-0000000000a2/a1.jpg', 'Lake view', 1600, 1067, 900000)$$);
select pg_temp.as_owner('insert other', '1e1e0000-0000-4000-8000-0000000000a1',
  $$insert into app.property_images (property_id, object_path, alt, width, height, bytes)
    values ('1e1e0000-0000-4000-8000-0000000000b2', '1e1e0000-0000-4000-8000-0000000000b2/x.jpg', 'Other', 1, 1, 1)$$);
select pg_temp.as_owner('read', '1e1e0000-0000-4000-8000-0000000000a1',
  $$insert into probes select 'read count', count(*)::integer from app.property_images$$);
select pg_temp.as_owner('touch other', '1e1e0000-0000-4000-8000-0000000000a1',
  $$update app.property_images set alt = 'Changed' where property_id = '1e1e0000-0000-4000-8000-0000000000b2';
    delete from app.property_images where property_id = '1e1e0000-0000-4000-8000-0000000000b2'$$);

select is((select n from probes where name = 'insert own'), 1, 'an owner inserts the hero of their own property');
select is((select n from probes where name = 'insert other'), 0, 'an owner cannot add a hero to another host''s property');
select is((select n from probes where name = 'read count'), 2, 'an owner reads only their own heroes');
select is(
  (select alt from app.property_images where property_id = '1e1e0000-0000-4000-8000-0000000000b2'),
  'B',
  'an owner cannot update or delete another host''s hero'
);
select throws_ok(
  $$insert into app.property_images (property_id, object_path, alt, width, height, bytes)
    values ('1e1e0000-0000-4000-8000-0000000000b2', 'x/empty.jpg', '', 1, 1, 1)$$,
  '23514', null, 'alt text is required'
);
select throws_ok(
  $$insert into app.property_images (property_id, object_path, alt, width, height, bytes)
    values ('1e1e0000-0000-4000-8000-0000000000b2', 'x/big.jpg', 'Big', 1, 1, 1048577)$$,
  '23514', null, 'a hero above 1 MiB is rejected'
);

select pg_temp.guest('own', 'pgtapHeroLinkA00001', '1e1e0000-0000-4000-8000-0000000000a2');
select pg_temp.guest('cross', 'pgtapHeroLinkA00001', '1e1e0000-0000-4000-8000-0000000000b2');
select pg_temp.guest('disabled', 'pgtapHeroLinkOld001', '1e1e0000-0000-4000-8000-0000000000a2');
select pg_temp.guest('unpublished', 'pgtapHeroLinkC00001', '1e1e0000-0000-4000-8000-0000000000c2');

select is((select n from probes where name = 'own'), 1, 'a live link reads its own property''s hero');
select is((select n from probes where name = 'cross'), 0, 'a link for property A cannot read property B''s hero');
select is((select n from probes where name = 'disabled'), 0, 'a disabled or rotated link reads no hero');
select is((select n from probes where name = 'unpublished'), 0, 'an unpublished property serves no hero');

select pg_temp.as_owner('alt edit', '1e1e0000-0000-4000-8000-0000000000a1',
  $$update app.property_images set alt = 'Lake view at dusk' where property_id = '1e1e0000-0000-4000-8000-0000000000a2'$$);
select is((select count(*)::integer from app.storage_deletions), 0, 'an alt edit queues nothing');

select pg_temp.as_owner('replace', '1e1e0000-0000-4000-8000-0000000000a1',
  $$insert into app.property_images (property_id, object_path, alt, width, height, bytes)
    values ('1e1e0000-0000-4000-8000-0000000000a2', '1e1e0000-0000-4000-8000-0000000000a2/a2.jpg', 'New', 1600, 1067, 800000)
    on conflict (property_id) do update set
      object_path = excluded.object_path, alt = excluded.alt, width = excluded.width, height = excluded.height,
      bytes = excluded.bytes, created_at = now()$$);
select is(
  (select array_agg(object_path) from app.storage_deletions),
  array['1e1e0000-0000-4000-8000-0000000000a2/a1.jpg'],
  'replacing a hero queues the old path'
);

select pg_temp.as_owner('remove', '1e1e0000-0000-4000-8000-0000000000a1',
  $$delete from app.property_images where property_id = '1e1e0000-0000-4000-8000-0000000000a2'$$);
select ok(
  exists (select 1 from app.storage_deletions where object_path = '1e1e0000-0000-4000-8000-0000000000a2/a2.jpg'),
  'removing a hero queues its path'
);

delete from app.properties where id = '1e1e0000-0000-4000-8000-0000000000c2';
select ok(
  exists (select 1 from app.storage_deletions where object_path = '1e1e0000-0000-4000-8000-0000000000c2/c.jpg'),
  'deleting the property queues its hero path'
);

delete from auth.users where id = '1e1e0000-0000-4000-8000-0000000000b1';
select ok(
  exists (select 1 from app.storage_deletions where object_path = '1e1e0000-0000-4000-8000-0000000000b2/b.jpg'),
  'deleting the host account queues its hero path'
);

select pg_temp.as_owner('runtime reads queue', '1e1e0000-0000-4000-8000-0000000000a1',
  $$insert into probes select 'queue count', count(*)::integer from app.storage_deletions$$);
select pg_temp.as_owner('runtime forges path', '1e1e0000-0000-4000-8000-0000000000a1',
  $$insert into app.storage_deletions (object_path) values ('forged/path.jpg')$$);
select pg_temp.as_owner('runtime drains', '1e1e0000-0000-4000-8000-0000000000a1',
  $$delete from app.storage_deletions where object_path = '1e1e0000-0000-4000-8000-0000000000a2/a1.jpg'$$);
select is((select n from probes where name = 'queue count'), 4, 'the runtime reads every queued path');
select is((select n from probes where name = 'runtime forges path'), 0, 'the runtime cannot queue a path itself');
select is((select count(*)::integer from app.storage_deletions), 3, 'the runtime drains a queued path');

select * from finish();
rollback;
