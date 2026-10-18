-- Phase 4: guest link state invariants, link-scoped RLS context, and link audit actions.
set role app_migrator;

alter table app.audit_events drop constraint audit_events_action_check;
alter table app.audit_events add constraint audit_events_action_check
  check (
    action in (
      'sign_in',
      'callback_failure',
      'mfa_enrolled',
      'mfa_unenrolled',
      'publish',
      'unpublish',
      'link_created',
      'link_rotated',
      'link_disabled'
    )
  );

-- One active link per property; a disabled row keeps metadata only (no digest, no sessions).
create unique index share_links_one_enabled_idx on app.share_links (property_id) where enabled;
alter table app.share_links add constraint share_links_state_check
  check (enabled = (disabled_at is null and secret_hmac is not null));
alter table app.share_links add constraint share_links_id_check
  check (id ~ '^[A-Za-z0-9_-]{16,64}$');
create index guest_sessions_link_idx on app.guest_sessions (share_link_id);

create function app.current_link_id() returns text
language sql stable
as $$ select nullif(current_setting('app.link_id', true), '') $$;

create function app.current_link_property_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.link_property_id', true), '')::uuid $$;

-- Guest policies are link-scoped only: the app sets app.link_id from the request and
-- app.link_property_id after it has validated the session against the link row.
create policy share_links_guest_read on app.share_links for select
  using (id = app.current_link_id() and enabled and secret_hmac is not null);

create policy guest_sessions_guest on app.guest_sessions for all
  using (share_link_id = app.current_link_id())
  with check (share_link_id = app.current_link_id());

create policy properties_guest_read on app.properties for select
  using (id = app.current_link_property_id() and published);

create policy guide_sections_guest_read on app.guide_sections for select
  using (
    published
    and visibility = 'guest'
    and property_id = app.current_link_property_id()
    and exists (select 1 from app.properties p where p.id = property_id and p.published)
  );

grant execute on function app.current_link_id() to app_runtime;
grant execute on function app.current_link_property_id() to app_runtime;

reset role;
