-- Phase 3: host-only secret fields plus the audit and setup-funnel event vocabulary.
set role app_migrator;

-- Structured secret values are host-side only: a guest-visible section can never carry one.
alter table app.guide_sections add column secret_value text;
alter table app.guide_sections add constraint guide_sections_secret_host_only
  check (secret_value is null or visibility = 'host');

alter table app.audit_events drop constraint audit_events_action_check;
alter table app.audit_events add constraint audit_events_action_check
  check (action in ('sign_in', 'callback_failure', 'mfa_enrolled', 'mfa_unenrolled', 'publish', 'unpublish'));

alter table app.setup_events add constraint setup_events_event_type_check
  check (
    event_type in (
      'sign_in',
      'property_created',
      'section_saved',
      'preview_opened',
      'publish_clicked',
      'support_requested'
    )
  );

reset role;
