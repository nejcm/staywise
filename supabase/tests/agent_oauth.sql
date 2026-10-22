-- Agent OAuth: the code binding columns and the definer access-token and owner lookups. Synthetic; rolls back.
begin;

create extension if not exists pgtap;

select plan(14);

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
  ('a7e10000-0000-4000-8000-0000000000a1', 'pgtap-oauth-a@example.test'),
  ('a7e10000-0000-4000-8000-0000000000b1', 'pgtap-oauth-b@example.test');
insert into app.agent_grants (id, owner_id, kind, name, client_id, resource, scopes, expires_at, revoked_at) values
  ('a7e10000-0000-4000-8000-0000000000a3', 'a7e10000-0000-4000-8000-0000000000a1', 'oauth', 'Active', 'https://claude.ai/c', 'http://localhost:3000/mcp', '{read}', now() + interval '90 days', null),
  ('a7e10000-0000-4000-8000-0000000000a4', 'a7e10000-0000-4000-8000-0000000000a1', 'oauth', 'Revoked', 'https://claude.ai/c', 'http://localhost:3000/mcp', '{read}', now() + interval '90 days', now());
insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at, code_challenge, redirect_uri) values
  (sha256('oa-access'), 'a7e10000-0000-4000-8000-0000000000a3', 'access', now() + interval '1 hour', null, null),
  (sha256('oa-access-old'), 'a7e10000-0000-4000-8000-0000000000a3', 'access', now() - interval '1 second', null, null),
  (sha256('oa-refresh'), 'a7e10000-0000-4000-8000-0000000000a3', 'refresh', now() + interval '30 days', null, null),
  (sha256('oa-revoked'), 'a7e10000-0000-4000-8000-0000000000a4', 'access', now() + interval '1 hour', null, null),
  (sha256('oa-code'), 'a7e10000-0000-4000-8000-0000000000a3', 'code', now() + interval '60 seconds', repeat('A', 43), 'http://127.0.0.1/cb');

select is(
  pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_access_token(sha256('oa-access'), 'http://localhost:3000/mcp')
    where owner_id = 'a7e10000-0000-4000-8000-0000000000a1' and scopes = '{read}'$$),
  1, 'the runtime resolves an active access token for its resource without an owner context');
select is(pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_access_token(sha256('oa-access'), 'https://other.example/mcp')$$), 0, 'an access token does not resolve for another resource');
select is(pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_access_token(sha256('oa-access-old'), 'http://localhost:3000/mcp')$$), 0, 'an expired access token does not resolve');
select is(pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_access_token(sha256('oa-revoked'), 'http://localhost:3000/mcp')$$), 0, 'an access token of a revoked grant does not resolve');
select is(pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_access_token(sha256('oa-refresh'), 'http://localhost:3000/mcp')$$), 0, 'a refresh token is not a bearer');
select is(pg_temp.count_as(null, $$select count(*)::integer from app.resolve_agent_access_token(sha256('oa-code'), 'http://localhost:3000/mcp')$$), 0, 'a code is not a bearer');
select is(
  pg_temp.count_as(null, $$select count(*)::integer where app.agent_grant_token_owner(sha256('oa-code')) = 'a7e10000-0000-4000-8000-0000000000a1'$$),
  1, 'the owner lookup names the owner behind a digest');
select is(pg_temp.count_as(null, $$select count(*)::integer where app.agent_grant_token_owner(sha256('oa-unknown')) is null$$), 1, 'an unknown digest has no owner');
select is(
  pg_temp.count_as('a7e10000-0000-4000-8000-0000000000b1', $$select count(*)::integer from app.agent_grant_tokens$$),
  0, 'the lookups leave the owner policy on grant tokens unwidened');
select ok(
  not has_function_privilege('anon', 'app.resolve_agent_access_token(bytea, text)', 'execute')
    and not has_function_privilege('authenticated', 'app.resolve_agent_access_token(bytea, text)', 'execute')
    and not has_function_privilege('anon', 'app.agent_grant_token_owner(bytea)', 'execute')
    and not has_function_privilege('authenticated', 'app.agent_grant_token_owner(bytea)', 'execute'),
  'anon and authenticated cannot call either lookup');
select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
    where oid in ('app.resolve_agent_access_token(bytea, text)'::regprocedure, 'app.agent_grant_token_owner(bytea)'::regprocedure)),
  'both lookups are security definer with an empty search_path');

select is(
  pg_temp.state_as('a7e10000-0000-4000-8000-0000000000a1', $$insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at)
    values (sha256('oa-bare-code'), 'a7e10000-0000-4000-8000-0000000000a3', 'code', now() + interval '60 seconds')$$),
  '23514', 'a code must carry its PKCE challenge and redirect URI');
select is(
  pg_temp.state_as('a7e10000-0000-4000-8000-0000000000a1', $$insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at, code_challenge, redirect_uri)
    values (sha256('oa-bound-access'), 'a7e10000-0000-4000-8000-0000000000a3', 'access', now() + interval '1 hour', repeat('A', 43), 'http://127.0.0.1/cb')$$),
  '23514', 'only a code carries PKCE and redirect fields');
select is(
  pg_temp.state_as('a7e10000-0000-4000-8000-0000000000a1', $$insert into app.agent_grant_tokens (token_hash, grant_id, kind, expires_at, code_challenge, redirect_uri)
    values (sha256('oa-bad-challenge'), 'a7e10000-0000-4000-8000-0000000000a3', 'code', now() + interval '60 seconds', 'short', 'http://127.0.0.1/cb')$$),
  '23514', 'the challenge is a 43-character base64url S256 digest');

select * from finish();
rollback;
