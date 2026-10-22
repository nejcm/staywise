-- Policy hardening from the 2026-10 security audit: guest reads recheck the live link, guest sessions cannot be
-- rewritten, a revoked agent grant stays revoked, and the fingerprint windows are runtime-only.
set role app_migrator;

-- properties_guest_read cannot read app.share_links in a subquery: share_links_owner reads app.properties, so the
-- policies would expand into each other. This definer helper is opaque to policy expansion. As the migration role
-- it sees every link row (share_links_retention_select), so it applies share_links_guest_read's expiry itself.
create function app.current_link_live(p_property_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from app.share_links l
    where l.id = app.current_link_id()
      and l.enabled
      and l.secret_hmac is not null
      and (l.expires_at is null or l.expires_at > now())
      and l.property_id = p_property_id
  )
$$;

revoke all on function app.current_link_live(uuid) from public, anon, authenticated;
grant execute on function app.current_link_live(uuid) to app_runtime;

-- The link row is rechecked, as in property_credentials_guest_read, so a disabled, rotated, or expired link reads
-- nothing even with a stale property context.
drop policy properties_guest_read on app.properties;
create policy properties_guest_read on app.properties for select
  using (id = app.current_link_property_id() and published and app.current_link_live(id));

drop policy guide_sections_guest_read on app.guide_sections;
create policy guide_sections_guest_read on app.guide_sections for select
  using (
    published
    and visibility = 'guest'
    and property_id = app.current_link_property_id()
    and exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id() and l.enabled and l.secret_hmac is not null and l.property_id = guide_sections.property_id
    )
    and exists (select 1 from app.properties p where p.id = property_id and p.published)
  );

-- The link exchange inserts, validation selects, and housekeeping deletes; a guest context never extends a session.
drop policy guest_sessions_guest on app.guest_sessions;
create policy guest_sessions_guest_select on app.guest_sessions for select
  using (share_link_id = app.current_link_id());
create policy guest_sessions_guest_insert on app.guest_sessions for insert
  with check (share_link_id = app.current_link_id());
create policy guest_sessions_guest_delete on app.guest_sessions for delete
  using (share_link_id = app.current_link_id());

-- Revocation is final: the runtime may revoke a live grant, never clear or move an existing revocation.
create function app.agent_grants_keep_revocation() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'a revoked agent grant stays revoked' using errcode = '23514';
end $$;

revoke all on function app.agent_grants_keep_revocation() from public, anon, authenticated;

create trigger agent_grants_keep_revocation before update on app.agent_grants
  for each row
  when (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
  execute function app.agent_grants_keep_revocation();

-- Fingerprint windows are runtime-only; retention_cleanup (owned by this role) keeps its select and delete.
drop policy rate_limits_runtime on app.rate_limits;
create policy rate_limits_runtime on app.rate_limits for all to app_runtime using (true) with check (true);
create policy rate_limits_retention_select on app.rate_limits for select to app_migrator using (true);
create policy rate_limits_retention_delete on app.rate_limits for delete to app_migrator using (true);

reset role;
