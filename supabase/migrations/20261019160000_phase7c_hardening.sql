-- Phase 7c: property deletion removes every property-scoped row, including all rate-limit
-- fingerprints; the host delete action and its audit vocabulary are added in the same change.
-- Legacy fingerprints carry no tenant link and expire within a day, so clearing them is lossless
-- for rate limiting and lets the new column be NOT NULL from the start.
delete from app.rate_limits;

set role app_migrator;

alter table app.rate_limits add column property_id uuid;
alter table app.rate_limits add constraint rate_limits_property_fk
  foreign key (property_id) references app.properties (id) on delete cascade;
alter table app.rate_limits alter column property_id set not null;
create index rate_limits_property_idx on app.rate_limits (property_id);

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
      'delete'
    )
  );

reset role;
