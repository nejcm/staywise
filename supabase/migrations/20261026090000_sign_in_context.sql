-- Sign-in context for the host's Security activity: a parsed device label and coarse place, never the raw User-Agent or IP.
set role app_migrator;

alter table app.audit_events drop constraint audit_events_action_check;
alter table app.audit_events add constraint audit_events_action_check check (
  action in (
    'sign_in',
    'callback_failure',
    'mfa_enrolled',
    'mfa_unenrolled',
    'mfa_verified',
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
    'stay_link_revoked',
    'agent_tool_call',
    'agent_grant_created',
    'agent_grant_revoked',
    'agent_grants_revoked_all'
  )
);

alter table app.audit_events
  add column device_label text check (
    device_label is null or (char_length(device_label) between 1 and 60 and device_label !~ '[[:cntrl:]]')
  ),
  add column country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column city text check (city is null or (char_length(city) between 1 and 80 and city !~ '[[:cntrl:]]')),
  add column new_device boolean,
  add constraint audit_events_sign_in_context_check check (
    action in ('sign_in', 'mfa_verified')
    or (device_label is null and country_code is null and city is null and new_device is null)
  );

create index audit_events_sign_in_device_idx on app.audit_events (actor_id, device_label, created_at)
  where device_label is not null;

-- Account deletion nulls the actor; the device and place go with it so no orphaned row keeps them.
create function app.audit_events_forget_sign_in_context() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.actor_id is null and old.actor_id is not null then
    new.device_label := null;
    new.country_code := null;
    new.city := null;
    new.new_device := null;
  end if;
  return new;
end $$;

create trigger audit_events_forget_sign_in_context before update of actor_id on app.audit_events
  for each row execute function app.audit_events_forget_sign_in_context();

reset role;
