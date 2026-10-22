-- Agent OAuth (plans/agent_access_plan.md, phase 3): code binding columns and the definer token lookups.
set role app_migrator;

-- A code carries its PKCE challenge and redirect URI to /oauth/token; other token kinds carry neither.
alter table app.agent_grant_tokens
  add column code_challenge text check (code_challenge is null or code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  add column redirect_uri text check (redirect_uri is null or char_length(redirect_uri) <= 2000),
  add constraint agent_grant_tokens_code_fields_check check (
    (kind = 'code') = (code_challenge is not null and redirect_uri is not null)
  );

-- Definer so /mcp resolves only an active access token bound to this resource, as for personal tokens.
create function app.resolve_agent_access_token(p_digest bytea, p_resource text)
  returns table (grant_id uuid, owner_id uuid, scopes text[], property_id uuid, last_used_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select g.id, g.owner_id, g.scopes, g.property_id, g.last_used_at
  from app.agent_grant_tokens t
  join app.agent_grants g on g.id = t.grant_id
  where t.token_hash = p_digest and t.kind = 'access' and t.expires_at > now()
    and g.kind = 'oauth' and g.resource = p_resource and g.revoked_at is null and g.expires_at > now()
$$;

-- The token and revoke endpoints have no session: this names the owner behind one digest, nothing else.
create function app.agent_grant_token_owner(p_digest bytea)
  returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select g.owner_id
  from app.agent_grant_tokens t
  join app.agent_grants g on g.id = t.grant_id
  where t.token_hash = p_digest and g.kind = 'oauth'
$$;

revoke all on function app.resolve_agent_access_token(bytea, text) from public, anon, authenticated;
grant execute on function app.resolve_agent_access_token(bytea, text) to app_runtime;
revoke all on function app.agent_grant_token_owner(bytea) from public, anon, authenticated;
grant execute on function app.agent_grant_token_owner(bytea) to app_runtime;

reset role;
