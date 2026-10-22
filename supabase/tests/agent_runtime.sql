-- Agent access runtime: the definer bearer lookup and the per-call audit columns. Synthetic; rolls back.
begin;

create extension if not exists pgtap;

select plan(16);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

create function pg_temp.state_as(p_owner uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_state text := 'ok';
begin
  perform set_config('app.owner_id', coalesce(p_owner::text, ''), true);
  set local role app_runtime;
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  perform set_config('app.owner_id', '', true);
  return v_state;
end $$;

create function pg_temp.count_as(p_owner uuid, p_sql text) returns integer
language plpgsql as $$
declare
  v integer;
begin
  perform set_config('app.owner_id', coalesce(p_owner::text, ''), true);
  set local role app_runtime;
  execute p_sql into v;
  reset role;
  perform set_config('app.owner_id', '', true);
  return v;
end $$;

insert into auth.users (id, email) values
  ('a7e00000-0000-4000-8000-0000000000a1', 'pgtap-runtime-a@example.test'),
  ('a7e00000-0000-4000-8000-0000000000b1', 'pgtap-runtime-b@example.test');
insert into app.properties (id, owner_id, display_name) values
  ('a7e00000-0000-4000-8000-0000000000a2', 'a7e00000-0000-4000-8000-0000000000a1', 'Runtime A');
insert into app.agent_grants (id, owner_id, kind, name, token_hash, scopes, property_id, created_at, expires_at, revoked_at) values
  ('a7e00000-0000-4000-8000-0000000000a3', 'a7e00000-0000-4000-8000-0000000000a1', 'pat', 'Active', sha256('rt-active'), '{read}', 'a7e00000-0000-4000-8000-0000000000a2', now(), now() + interval '30 days', null),
  ('a7e00000-0000-4000-8000-0000000000a4', 'a7e00000-0000-4000-8000-0000000000a1', 'pat', 'Revoked', sha256('rt-revoked'), '{read}', null, now(), now() + interval '30 days', now()),
  ('a7e00000-0000-4000-8000-0000000000a5', 'a7e00000-0000-4000-8000-0000000000a1', 'pat', 'Expired', sha256('rt-expired'), '{read}', null, now() - interval '10 days', now() - interval '1 second', null);

select is(
  pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_token(sha256('rt-active'))$$),
  1, 'the runtime resolves an active personal token without an owner context');
select is(
  pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_token(sha256('rt-active'))
    where owner_id = 'a7e00000-0000-4000-8000-0000000000a1' and scopes = '{read}'
      and property_id = 'a7e00000-0000-4000-8000-0000000000a2'$$),
  1, 'the lookup returns the owner, scopes and property restriction');
select is(pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_token(sha256('rt-revoked'))$$), 0, 'a revoked token does not resolve');
select is(pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_token(sha256('rt-expired'))$$), 0, 'an expired token does not resolve');
select is(pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_token(sha256('rt-unknown'))$$), 0, 'an unknown digest does not resolve');
select is(
  pg_temp.count_as('a7e00000-0000-4000-8000-0000000000b1', $$select count(*)::integer from app.agent_grants$$),
  0, 'the lookup leaves the owner policy on grants unwidened');
select ok(not has_function_privilege('anon', 'app.resolve_agent_token(bytea)', 'execute'), 'anon cannot call the lookup');
select ok(not has_function_privilege('authenticated', 'app.resolve_agent_token(bytea)', 'execute'), 'authenticated cannot call the lookup');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'app.resolve_agent_token(bytea)'::regprocedure),
  'the lookup is security definer with an empty search_path');

select is(
  pg_temp.state_as('a7e00000-0000-4000-8000-0000000000a1', $$insert into app.audit_events
    (actor_id, action, grant_id, tool, property_ids, row_count, outcome, latency_ms, args_digest)
    values ('a7e00000-0000-4000-8000-0000000000a1', 'agent_tool_call', 'a7e00000-0000-4000-8000-0000000000a3',
      'get_property', '{a7e00000-0000-4000-8000-0000000000a2}', 3, 'ok', 12, sha256('{}'))$$),
  'ok', 'the runtime appends a tool-call audit row with its metadata');
select is(
  pg_temp.state_as('a7e00000-0000-4000-8000-0000000000a1', $$insert into app.audit_events (actor_id, action)
    values ('a7e00000-0000-4000-8000-0000000000a1', 'agent_tool_call')$$),
  '23514', 'a tool-call audit row must name its tool');
select is(
  pg_temp.state_as('a7e00000-0000-4000-8000-0000000000a1', $$insert into app.audit_events (actor_id, action, tool)
    values ('a7e00000-0000-4000-8000-0000000000a1', 'sign_in', 'get_property')$$),
  '23514', 'only tool-call rows carry a tool');
select is(
  pg_temp.state_as('a7e00000-0000-4000-8000-0000000000a1', $$insert into app.audit_events
    (actor_id, action, grant_id, tool, outcome, latency_ms)
    values ('a7e00000-0000-4000-8000-0000000000a1', 'agent_tool_call', 'a7e00000-0000-4000-8000-0000000000a3', 'get_property', 'ok', 1)$$),
  '23514', 'a tool-call audit row requires the argument digest');
select is(
  pg_temp.state_as('a7e00000-0000-4000-8000-0000000000a1', $$insert into app.audit_events
    (actor_id, action, grant_id, tool, outcome, latency_ms, args_digest)
    values ('a7e00000-0000-4000-8000-0000000000a1', 'agent_tool_call', 'a7e00000-0000-4000-8000-0000000000a3', 'get_property', 'ok', 1, '\x00'::bytea)$$),
  '23514', 'the argument digest is a 32-byte SHA-256');
select is(
  pg_temp.state_as('a7e00000-0000-4000-8000-0000000000a1', $$insert into app.audit_events
    (actor_id, action, grant_id, tool, outcome, latency_ms, args_digest)
    values ('a7e00000-0000-4000-8000-0000000000a1', 'agent_tool_call', 'a7e00000-0000-4000-8000-0000000000a3', 'get_property', 'leaked', 1, sha256('{}'))$$),
  '23514', 'the outcome is one of ok, denied or error');
select is(
  pg_temp.state_as('a7e00000-0000-4000-8000-0000000000b1', $$insert into app.audit_events
    (actor_id, action, grant_id, tool, outcome, latency_ms, args_digest)
    values ('a7e00000-0000-4000-8000-0000000000a1', 'agent_tool_call', 'a7e00000-0000-4000-8000-0000000000a3', 'get_property', 'ok', 1, sha256('{}'))$$),
  '42501', 'a host cannot append tool-call rows as another host');

select * from finish();
rollback;
