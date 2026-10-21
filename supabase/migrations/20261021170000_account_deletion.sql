-- Host account deletion (ADR 0002): the Auth admin API deletes auth.users and the existing FKs
-- cascade every owner row; only the audit vocabulary changes here.
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
      'link_disabled',
      'translation_generated',
      'translation_approved',
      'translation_rejected',
      'message_handled',
      'message_tagged',
      'message_deleted',
      'delete',
      'account_deleted'
    )
  );

reset role;
