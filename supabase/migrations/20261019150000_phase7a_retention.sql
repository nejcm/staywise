-- Phase 7a: retention cleanup — one idempotent boundary function, retention delete policies for the
-- role the definer function runs as, and the nightly pg_cron schedule.
-- pg_cron only runs in cron.database_name (default postgres); only scratch_-prefixed test databases may skip.
do $$
begin
  if current_database() = coalesce(current_setting('cron.database_name', true), 'postgres') then
    create extension if not exists pg_cron;
    perform cron.schedule('staywise-retention-cleanup', '17 3 * * *', 'select app.retention_cleanup()');
  elsif current_database() not like 'scratch\_%' then
    raise exception 'retention cleanup cannot be scheduled in %: not cron.database_name', current_database();
  end if;
end $$;

set role app_migrator;

-- Retention clock: every cutoff derives from the explicit boundary (default now()), strict `<` keeps
-- a row exactly at the boundary for the full window. Messages expire 90 days after receipt (host
-- deletion is the earlier route), audit and setup events after 90 days, reservations 90 days after
-- the stay's UTC end date, disabled-link metadata after 30 days, guest sessions once expired, and
-- rate windows before the boundary's UTC day start. Counters have no plan window and are kept;
-- translations are removed by property deletion, never by age.
create function app.retention_cleanup(p_now timestamptz default now()) returns jsonb
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

  return jsonb_build_object(
    'boundary', p_now,
    'guest_messages', v_guest_messages,
    'audit_events', v_audit_events,
    'setup_events', v_setup_events,
    'reservations', v_reservations,
    'share_links', v_share_links,
    'guest_sessions', v_guest_sessions,
    'rate_limits', v_rate_limits
  );
end $$;

-- These tables force RLS even for their owner. A DELETE ... WHERE also reads the rows it targets, so
-- the definer function needs both the read and the delete side; the age boundary stays in the
-- function, the only granted caller.
create policy guest_messages_retention_select on app.guest_messages for select to app_migrator using (true);
create policy guest_messages_retention_delete on app.guest_messages for delete to app_migrator using (true);
create policy audit_events_retention_select on app.audit_events for select to app_migrator using (true);
create policy audit_events_retention_delete on app.audit_events for delete to app_migrator using (true);
create policy setup_events_retention_select on app.setup_events for select to app_migrator using (true);
create policy setup_events_retention_delete on app.setup_events for delete to app_migrator using (true);
create policy reservations_retention_select on app.reservations for select to app_migrator using (true);
create policy reservations_retention_delete on app.reservations for delete to app_migrator using (true);
create policy share_links_retention_select on app.share_links for select to app_migrator using (true);
create policy share_links_retention_delete on app.share_links for delete to app_migrator using (true);
create policy guest_sessions_retention_select on app.guest_sessions for select to app_migrator using (true);
create policy guest_sessions_retention_delete on app.guest_sessions for delete to app_migrator using (true);

-- The runtime role must not be able to purge rows across tenants; rate_limits keeps its existing
-- runtime policy and needs no retention policy.
revoke all on function app.retention_cleanup(timestamptz) from public;

reset role;
