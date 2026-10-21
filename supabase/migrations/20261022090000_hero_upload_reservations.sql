-- Uploads reserve their object path in the deletion queue before any bytes are written (ADR 0005).
set role app_migrator;

-- The drain skips a row until not_before, so an in-flight upload's bytes are never removed under it.
alter table app.storage_deletions add column not_before timestamptz not null default now();

-- Definer so the runtime can queue only a fresh key under a property it owns, never an arbitrary path.
create function app.reserve_hero_upload(p_property_id uuid, p_object_path text) returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if p_object_path !~ ('^' || p_property_id::text || '/[0-9a-f-]{36}\.jpg$') then
    return false;
  end if;
  if not exists (
    select 1 from app.properties p where p.id = p_property_id and p.owner_id = app.current_owner_id()
  ) then
    return false;
  end if;
  insert into app.storage_deletions (object_path, not_before) values (p_object_path, now() + interval '10 minutes');
  return true;
end $$;

revoke all on function app.reserve_hero_upload(uuid, text) from public, anon, authenticated;
grant execute on function app.reserve_hero_upload(uuid, text) to app_runtime;

reset role;
