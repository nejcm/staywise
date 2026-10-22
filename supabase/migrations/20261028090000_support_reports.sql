-- Host support reports (90-day retention).
-- Created before the role switch: app_migrator cannot reference auth.users, so ownership moves after.
create table app.support_reports (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('issue', 'help')),
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index support_reports_owner_idx on app.support_reports (owner_id);

alter table app.support_reports owner to app_migrator;
alter sequence app.support_reports_id_seq owner to app_migrator;

set role app_migrator;

alter table app.support_reports enable row level security;
alter table app.support_reports force row level security;

create policy support_reports_owner on app.support_reports
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());

create policy support_reports_retention_select on app.support_reports for select to app_migrator using (true);
create policy support_reports_retention_delete on app.support_reports for delete to app_migrator using (true);

-- Hosts file and read their own reports; the runtime never edits or deletes one.
grant select, insert on app.support_reports to app_runtime;
grant usage on sequence app.support_reports_id_seq to app_runtime;

-- Adds support reports (90 days); every other rule is unchanged.
create or replace function app.retention_cleanup(p_now timestamptz default now()) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_event_cutoff timestamptz := p_now - interval '90 days';
  v_metadata_cutoff timestamptz := p_now - interval '30 days';
  v_stay_cutoff date := (p_now at time zone 'utc')::date - 90;
  v_counter_cutoff date := (p_now at time zone 'utc')::date - 400;
  v_window_cutoff timestamptz := date_trunc('day', p_now at time zone 'utc') at time zone 'utc';
  v_guest_messages integer;
  v_audit_events integer;
  v_setup_events integer;
  v_reservations integer;
  v_share_links integer;
  v_guest_sessions integer;
  v_rate_limits integer;
  v_auth_rate_limits integer;
  v_guest_counters integer;
  v_agent_grants integer;
  v_agent_grant_tokens integer;
  v_guide_section_revisions integer;
  v_support_reports integer;
begin
  delete from app.guest_messages where created_at < v_event_cutoff;
  get diagnostics v_guest_messages = row_count;

  delete from app.audit_events where created_at < v_event_cutoff;
  get diagnostics v_audit_events = row_count;

  delete from app.setup_events where created_at < v_event_cutoff;
  get diagnostics v_setup_events = row_count;

  delete from app.reservations where stay_end < v_stay_cutoff;
  get diagnostics v_reservations = row_count;

  delete from app.share_links where disabled_at is not null and disabled_at < v_metadata_cutoff;
  get diagnostics v_share_links = row_count;

  delete from app.guest_sessions where expires_at <= p_now;
  get diagnostics v_guest_sessions = row_count;

  delete from app.rate_limits where window_start < v_window_cutoff;
  get diagnostics v_rate_limits = row_count;

  delete from app.auth_rate_limits where window_start < v_window_cutoff;
  get diagnostics v_auth_rate_limits = row_count;

  delete from app.guest_counters where day < v_counter_cutoff;
  get diagnostics v_guest_counters = row_count;

  delete from app.guide_section_revisions where created_at < v_event_cutoff;
  get diagnostics v_guide_section_revisions = row_count;

  delete from app.agent_grant_tokens where expires_at <= p_now;
  get diagnostics v_agent_grant_tokens = row_count;

  -- least() skips a null revoked_at; the cascade takes any remaining token and revision rows.
  delete from app.agent_grants where least(revoked_at, expires_at) < v_event_cutoff;
  get diagnostics v_agent_grants = row_count;

  delete from app.support_reports where created_at < v_event_cutoff;
  get diagnostics v_support_reports = row_count;

  return jsonb_build_object(
    'boundary', p_now,
    'guest_messages', v_guest_messages,
    'audit_events', v_audit_events,
    'setup_events', v_setup_events,
    'reservations', v_reservations,
    'share_links', v_share_links,
    'guest_sessions', v_guest_sessions,
    'rate_limits', v_rate_limits,
    'auth_rate_limits', v_auth_rate_limits,
    'guest_counters', v_guest_counters,
    'guide_section_revisions', v_guide_section_revisions,
    'agent_grant_tokens', v_agent_grant_tokens,
    'agent_grants', v_agent_grants,
    'support_reports', v_support_reports
  );
end $$;

reset role;
