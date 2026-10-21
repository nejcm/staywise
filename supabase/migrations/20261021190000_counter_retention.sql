-- Guest counters carry no guest identity but grew without bound; daily rows older than 400 days
-- (a year of year-over-year comparison plus slack) now go with the nightly cleanup.
set role app_migrator;

create policy guest_counters_retention_select on app.guest_counters for select to app_migrator using (true);
create policy guest_counters_retention_delete on app.guest_counters for delete to app_migrator using (true);

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
    'guest_counters', v_guest_counters
  );
end $$;

revoke all on function app.retention_cleanup(timestamptz) from public;

reset role;
