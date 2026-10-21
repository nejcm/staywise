-- Agent access schema (plans/agent_access_plan.md, phase 0): grants, OAuth token digests, guide revisions.
set role app_migrator;

-- Per-property import keys: one host's source and external ID can never collide with, or reveal, another's.
alter table app.reservations drop constraint reservations_source_external_id_key;
alter table app.reservations add constraint reservations_property_source_external_id_key unique (property_id, source, external_id);
drop index app.reservations_property_idx;

alter table app.api_tokens rename to agent_grants;
alter index app.api_tokens_pkey rename to agent_grants_pkey;
alter index app.api_tokens_token_hash_key rename to agent_grants_token_hash_key;
alter index app.api_tokens_owner_idx rename to agent_grants_owner_idx;
alter table app.agent_grants rename constraint api_tokens_owner_id_fkey to agent_grants_owner_id_fkey;
alter table app.agent_grants rename constraint api_tokens_property_id_fkey to agent_grants_property_id_fkey;
alter policy api_tokens_owner on app.agent_grants rename to agent_grants_owner;
alter table app.agent_grants drop constraint api_tokens_scopes_check;
-- Grants are revoked, never rotated (Q5).
alter table app.agent_grants drop column rotated_at;
alter table app.agent_grants alter column token_hash drop not null;
-- No column defaults: a pre-existing row predates the expiry contract, so the migration fails instead of keeping it.
alter table app.agent_grants
  add column kind text not null check (kind in ('pat', 'oauth')),
  add column name text not null check (char_length(name) between 1 and 100),
  add column client_id text check (client_id is null or char_length(client_id) <= 500),
  add column resource text check (resource is null or char_length(resource) <= 500),
  add column client_label text check (client_label is null or char_length(client_label) <= 100),
  add column expires_at timestamptz not null,
  add column revoked_at timestamptz,
  add constraint agent_grants_scopes_check check (
    cardinality(scopes) > 0 and scopes <@ array['read', 'content:write', 'reservations:write', 'inbox:write']::text[]
  ),
  add constraint agent_grants_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '90 days'),
  add constraint agent_grants_token_hash_check check (token_hash is null or octet_length(token_hash) = 32),
  -- A personal token is its own bearer digest; an OAuth grant holds its digests in agent_grant_tokens.
  add constraint agent_grants_kind_fields_check check (
    case kind
      when 'pat' then token_hash is not null and client_id is null
      else token_hash is null and client_id is not null and resource is not null
    end
  );

-- Digest-only rows for OAuth codes, access and refresh tokens; used_at detects code and refresh reuse (Q27).
create table app.agent_grant_tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  grant_id uuid not null references app.agent_grants (id) on delete cascade,
  kind text not null check (kind in ('code', 'access', 'refresh')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agent_grant_tokens_used_check check (used_at is null or kind in ('code', 'refresh'))
);
create index agent_grant_tokens_grant_idx on app.agent_grant_tokens (grant_id);

-- One row per agent write to a guide section, for the agent marker and one-click revert (Q21, Q23).
create table app.guide_section_revisions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references app.guide_sections (id) on delete cascade,
  grant_id uuid not null references app.agent_grants (id) on delete cascade,
  before_title text,
  before_body text,
  after_title text not null,
  after_body text not null,
  created_at timestamptz not null default now(),
  constraint guide_section_revisions_before_paired check ((before_title is null) = (before_body is null))
);
create index guide_section_revisions_section_idx on app.guide_section_revisions (section_id, created_at desc);
create index guide_section_revisions_grant_idx on app.guide_section_revisions (grant_id);

alter table app.agent_grant_tokens enable row level security;
alter table app.agent_grant_tokens force row level security;
alter table app.guide_section_revisions enable row level security;
alter table app.guide_section_revisions force row level security;

-- A grant may only be restricted to one of the owner's own properties.
alter policy agent_grants_owner on app.agent_grants
  using (owner_id = app.current_owner_id())
  with check (
    owner_id = app.current_owner_id()
    and (property_id is null or exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  );

create policy agent_grant_tokens_owner on app.agent_grant_tokens for all
  using (exists (select 1 from app.agent_grants g where g.id = grant_id and g.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.agent_grants g where g.id = grant_id and g.owner_id = app.current_owner_id()));

create policy guide_section_revisions_owner on app.guide_section_revisions for all
  using (
    exists (
      select 1 from app.guide_sections s
      join app.properties p on p.id = s.property_id
      where s.id = section_id and p.owner_id = app.current_owner_id()
    )
  )
  with check (
    exists (
      select 1 from app.guide_sections s
      join app.properties p on p.id = s.property_id
      where s.id = section_id and p.owner_id = app.current_owner_id()
    )
    and exists (select 1 from app.agent_grants g where g.id = grant_id and g.owner_id = app.current_owner_id())
  );

alter table app.audit_events drop constraint audit_events_action_check;
alter table app.audit_events add constraint audit_events_action_check check (
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

-- Adds agent retention: grants 90 days after revoke or expiry (whichever is first), OAuth token rows
-- at expiry, and guide revisions after 90 days; every other rule is unchanged from the initial schema.
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
    'agent_grants', v_agent_grants
  );
end $$;

create policy agent_grants_retention_select on app.agent_grants for select to app_migrator using (true);
create policy agent_grants_retention_delete on app.agent_grants for delete to app_migrator using (true);
create policy agent_grant_tokens_retention_select on app.agent_grant_tokens for select to app_migrator using (true);
create policy agent_grant_tokens_retention_delete on app.agent_grant_tokens for delete to app_migrator using (true);
create policy guide_section_revisions_retention_select on app.guide_section_revisions for select to app_migrator using (true);
create policy guide_section_revisions_retention_delete on app.guide_section_revisions for delete to app_migrator using (true);

-- Grants are revoked, never deleted or widened: retention and owner cascades are the only deleters.
revoke update, delete on app.agent_grants from app_runtime;
grant update (revoked_at, last_used_at, client_label) on app.agent_grants to app_runtime;
grant select, insert, update, delete on app.agent_grant_tokens to app_runtime;
-- Revisions are a record of what the agent wrote: hosts read, append, and delete them but never rewrite one.
grant select, insert, delete on app.guide_section_revisions to app_runtime;

reset role;
