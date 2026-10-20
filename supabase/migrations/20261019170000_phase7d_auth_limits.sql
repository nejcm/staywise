-- Phase 7d: app-side limit in front of Auth OTP sends. Auth sees every call from the server's
-- egress IP, so its per-IP bucket is shared by all hosts; these windows key on HMACs of the client
-- IP and of the address instead, carry no tenant, and are purged with the other rate windows.
set role app_migrator;

create table app.auth_rate_limits (
  key_hash bytea not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (key_hash, window_start)
);
create index auth_rate_limits_window_idx on app.auth_rate_limits (window_start);
alter table app.auth_rate_limits enable row level security;
alter table app.auth_rate_limits force row level security;
create policy auth_rate_limits_runtime on app.auth_rate_limits for all to app_runtime using (true) with check (true);
create policy auth_rate_limits_retention_select on app.auth_rate_limits for select to app_migrator using (true);
create policy auth_rate_limits_retention_delete on app.auth_rate_limits for delete to app_migrator using (true);
grant select, insert, update, delete on app.auth_rate_limits to app_runtime;

create or replace function app.retention_cleanup(p_now timestamptz default now()) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_event_cutoff timestamptz := p_now - interval '90 days';
  v_metadata_cutoff timestamptz := p_now - interval '30 days';
  v_stay_cutoff date := (p_now at time zone 'utc')::date - 90;
  v_window_cutoff timestamptz := date_trunc('day', p_now at time zone 'utc') at time zone 'utc';
  v_guest_messages integer;
  v_audit_events integer;
  v_setup_events integer;
  v_reservations integer;
  v_share_links integer;
  v_guest_sessions integer;
  v_rate_limits integer;
  v_auth_rate_limits integer;
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

  return jsonb_build_object(
    'boundary', p_now,
    'guest_messages', v_guest_messages,
    'audit_events', v_audit_events,
    'setup_events', v_setup_events,
    'reservations', v_reservations,
    'share_links', v_share_links,
    'guest_sessions', v_guest_sessions,
    'rate_limits', v_rate_limits,
    'auth_rate_limits', v_auth_rate_limits
  );
end $$;

revoke all on function app.retention_cleanup(timestamptz) from public;

reset role;
