-- Phase 6: guest message intake — alert recipient, guest locale and message invariants, guest
-- insert/counter policies, inbox audit vocabulary, and rate-window cleanup support.
set role app_migrator;

-- The host's sign-in address receives the minimal new-message alert; guests never see it.
alter table app.properties add column alert_email text;

alter table app.guest_messages add column locale text not null default 'en';
alter table app.guest_messages add constraint guest_messages_locale_check check (locale in ('en', 'de', 'sl'));
-- Bounded input is enforced at the canonical boundary; these constraints keep direct writers honest.
alter table app.guest_messages add constraint guest_messages_body_len_check check (char_length(body) between 1 and 2000);
alter table app.guest_messages add constraint guest_messages_email_len_check check (follow_up_email is null or char_length(follow_up_email) <= 254);
alter table app.guest_messages add constraint guest_messages_handled_check check ((state = 'handled') = (handled_at is not null));
alter table app.guest_messages add constraint guest_messages_answer_tag_check check (answer_in_guide is null or kind = 'question');

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
      'message_deleted'
    )
  );

reset role;

-- One-time upgrade backfill: only the migration runner can read auth.users, so this single
-- statement runs outside the app migration role. The column guard keeps the shared migrations
-- runnable against harness schemas whose auth.users has no email column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'email'
  ) then
    update app.properties p set alert_email = u.email from auth.users u
      where u.id = p.owner_id and p.alert_email is null;
  end if;
end $$;

set role app_migrator;

-- Guests may only insert into the link's own published property, inside the link context the app
-- establishes after validating the session; they never read, update, or delete stored messages.
create policy guest_messages_guest_insert on app.guest_messages for insert
  with check (
    property_id = app.current_link_property_id()
    and exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_messages.property_id
    )
    and exists (select 1 from app.properties p where p.id = guest_messages.property_id and p.published)
  );

-- Aggregate counters are host data guests only bump: link-scoped so every write lands on the
-- link's own property, never another host's.
create policy guest_counters_guest_insert on app.guest_counters for insert
  with check (
    exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_counters.property_id
    )
  );
create policy guest_counters_guest_select on app.guest_counters for select
  using (
    exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_counters.property_id
    )
  );
create policy guest_counters_guest_update on app.guest_counters for update
  using (
    exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_counters.property_id
    )
  )
  with check (
    exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_counters.property_id
    )
  );

create index rate_limits_window_idx on app.rate_limits (window_start);

reset role;
