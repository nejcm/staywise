-- Per-stay guest links (ADR 0004): a stay link belongs to one reservation and expires; the
-- property link keeps its one-enabled invariant, and expiry is enforced in the guest read policy.
set role app_migrator;

alter table app.reservations add constraint reservations_id_property_key unique (id, property_id);
alter table app.share_links
  add column kind text not null default 'property' check (kind in ('property', 'stay')),
  add column reservation_id uuid,
  add column expires_at timestamptz;
-- Composite key: a stay link can only point at a reservation of its own property.
alter table app.share_links add constraint share_links_reservation_fkey
  foreign key (reservation_id, property_id) references app.reservations (id, property_id) on delete cascade;
alter table app.share_links add constraint share_links_stay_check
  check ((kind = 'stay') = (reservation_id is not null and expires_at is not null));

drop index app.share_links_one_enabled_idx;
create unique index share_links_one_enabled_idx on app.share_links (property_id) where enabled and kind = 'property';
create unique index share_links_one_enabled_stay_idx on app.share_links (reservation_id) where enabled;

-- Every link-scoped policy reads app.share_links through this policy, so expiry applies to all of them.
drop policy share_links_guest_read on app.share_links;
create policy share_links_guest_read on app.share_links for select
  using (
    id = app.current_link_id() and enabled and secret_hmac is not null and (expires_at is null or expires_at > now())
  );

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
      'link_disabled',
      'translation_generated',
      'translation_approved',
      'translation_rejected',
      'message_handled',
      'message_tagged',
      'message_deleted',
      'delete',
      'account_deleted',
      'stay_link_created',
      'stay_link_revoked'
    )
  );

reset role;
