-- One hero photo per property (ADR 0005). The bucket has no storage.objects policies: only the server
-- touches it with the secret key, after reading the row under owner or live guest-link context.
-- Only scratch_-prefixed test databases, which have no Storage schema, may skip the bucket.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('guide-images', 'guide-images', false, 1048576, '{image/jpeg}')
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  elsif current_database() not like 'scratch\_%' then
    raise exception 'guide-images bucket cannot be created in %: no storage.buckets', current_database();
  end if;
end $$;

set role app_migrator;

create table app.property_images (
  property_id uuid primary key references app.properties (id) on delete cascade,
  object_path text not null unique,
  alt text not null check (char_length(alt) between 1 and 200),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes integer not null check (bytes between 1 and 1048576),
  created_at timestamptz not null default now()
);

-- Direct deletes from storage.objects are blocked, so replaced and deleted object paths wait here
-- until the server removes them through the Storage API.
create table app.storage_deletions (
  object_path text primary key,
  queued_at timestamptz not null default now()
);

alter table app.property_images enable row level security;
alter table app.property_images force row level security;
alter table app.storage_deletions enable row level security;
alter table app.storage_deletions force row level security;

create policy property_images_owner on app.property_images for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

-- The link row is rechecked (through share_links_guest_read, so expiry applies) like property_credentials_guest_read.
create policy property_images_guest_read on app.property_images for select
  using (
    property_id = app.current_link_property_id()
    and exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id() and l.enabled and l.secret_hmac is not null and l.property_id = property_images.property_id
    )
    and exists (select 1 from app.properties p where p.id = property_images.property_id and p.published)
  );

-- The queue holds object paths only; the drain needs every row regardless of tenant.
create policy storage_deletions_runtime_select on app.storage_deletions for select to app_runtime using (true);
create policy storage_deletions_runtime_delete on app.storage_deletions for delete to app_runtime using (true);
create policy storage_deletions_queue_insert on app.storage_deletions for insert to app_migrator with check (true);

-- Definer so cascades from app.properties and auth.users queue the path without a runtime insert grant.
create function app.queue_storage_deletion() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.object_path = new.object_path then
    return null;
  end if;
  insert into app.storage_deletions (object_path) values (old.object_path) on conflict do nothing;
  return null;
end $$;

create trigger property_images_queue_deletion
  after update of object_path or delete on app.property_images
  for each row
  execute function app.queue_storage_deletion();

revoke all on function app.queue_storage_deletion() from public, anon, authenticated;
grant select, insert, update, delete on app.property_images to app_runtime;
grant select, delete on app.storage_deletions to app_runtime;

reset role;
