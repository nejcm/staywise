-- Guest features 4b: a validated guest link reads its own property's credentials. The link row is
-- rechecked here so a disabled or rotated link reads nothing even with a stale property context.
set role app_migrator;

create policy property_credentials_guest_read on app.property_credentials for select
  using (
    property_id = app.current_link_property_id()
    and exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id() and l.enabled and l.secret_hmac is not null and l.property_id = property_credentials.property_id
    )
    and exists (select 1 from app.properties p where p.id = property_credentials.property_id and p.published)
  );

reset role;
