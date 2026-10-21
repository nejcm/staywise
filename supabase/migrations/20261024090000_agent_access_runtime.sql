-- Agent access runtime (plans/agent_access_plan.md, phase 1): bearer lookup and per-call audit detail.
set role app_migrator;

-- Definer so the runtime resolves only the active grant behind one digest, with no cross-owner read policy.
create function app.resolve_agent_token(p_digest bytea)
  returns table (grant_id uuid, owner_id uuid, scopes text[], property_id uuid, last_used_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select g.id, g.owner_id, g.scopes, g.property_id, g.last_used_at
  from app.agent_grants g
  where g.kind = 'pat' and g.token_hash = p_digest and g.revoked_at is null and g.expires_at > now()
$$;

revoke all on function app.resolve_agent_token(bytea) from public, anon, authenticated;
grant execute on function app.resolve_agent_token(bytea) to app_runtime;

-- Tool-call metadata only (Q23): never arguments, results, or the bearer; grant_id outlives grant retention.
alter table app.audit_events
  add column grant_id uuid,
  add column tool text check (tool is null or tool ~ '^[a-z_]{1,64}$'),
  add column property_ids uuid[] check (property_ids is null or cardinality(property_ids) <= 100),
  add column row_count integer check (row_count is null or row_count >= 0),
  add column outcome text check (outcome is null or outcome in ('ok', 'denied', 'error')),
  add column latency_ms integer check (latency_ms is null or latency_ms >= 0),
  add column args_digest bytea check (args_digest is null or octet_length(args_digest) = 32),
  add constraint audit_events_tool_call_check check (
    (action = 'agent_tool_call') = (tool is not null)
    and (tool is null or (grant_id is not null and outcome is not null and latency_ms is not null and args_digest is not null))
  );

reset role;
