-- Phase 2: host auth data model, migration-owner/runtime roles, RLS, grants.
-- Roles are created without credentials; a pre-provisioned credential is never reset here.
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_migrator') then
    execute 'create role app_migrator nologin nosuperuser nobypassrls';
  end if;
  if not exists (select from pg_roles where rolname = 'app_runtime') then
    execute $role$create role app_runtime login nosuperuser nocreatedb nocreaterole nobypassrls$role$;
  end if;
  -- The creator gets ADMIN-only membership implicitly, so always grant the SET option explicitly (re-granting updates options).
  execute format('grant app_migrator to %I with set true, inherit true', current_user);
  if exists (select from pg_roles where rolname in ('app_migrator', 'app_runtime') and rolsuper) then
    raise exception 'app roles must not be superusers';
  end if;
end $$;

-- NOSUPERUSER is creation-only for a CREATEROLE runner; the check above fails closed for a pre-existing superuser.
alter role app_migrator nologin nobypassrls;
alter role app_runtime login nocreatedb nocreaterole nobypassrls;

-- Runtime must never own objects, so the schema and tables are owned by the migration role.
alter schema app owner to app_migrator;
revoke all on schema app from public;
grant usage on schema app to app_runtime;

-- Tables are created by the runner because only it holds REFERENCES on auth.users; ownership moves below.
create table app.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  timezone text not null default 'UTC',
  source_locale text not null default 'en',
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_owner_idx on app.properties (owner_id);

create table app.guide_sections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references app.properties (id) on delete cascade,
  category text not null,
  title text not null,
  body text not null,
  visibility text not null default 'guest' check (visibility in ('guest', 'host')),
  display_order integer not null default 0,
  source_revision integer not null default 1,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index guide_sections_property_idx on app.guide_sections (property_id);

create table app.guide_translations (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references app.guide_sections (id) on delete cascade,
  locale text not null,
  title text not null,
  body text not null,
  source_revision integer not null,
  state text not null default 'draft' check (state in ('draft', 'approved')),
  provider text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (section_id, locale)
);

create table app.share_links (
  id text primary key,
  secret_hmac bytea,
  property_id uuid not null references app.properties (id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index share_links_property_idx on app.share_links (property_id);

create table app.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  session_hash bytea not null unique,
  share_link_id text not null references app.share_links (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table app.guest_messages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references app.properties (id) on delete cascade,
  kind text not null check (kind in ('issue', 'question')),
  category text,
  body text not null,
  follow_up_email text,
  state text not null default 'new' check (state in ('new', 'handled')),
  answer_in_guide boolean,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index guest_messages_property_created_idx on app.guest_messages (property_id, created_at desc);

create table app.rate_limits (
  key_hash bytea not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (key_hash, window_start)
);

create table app.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('sign_in', 'callback_failure', 'mfa_enrolled', 'mfa_unenrolled')),
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on app.audit_events (created_at);

create table app.reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references app.properties (id) on delete cascade,
  source text not null,
  external_id text not null,
  stay_start date not null,
  stay_end date not null,
  guest_first_name text,
  locale text,
  party_size integer check (party_size > 0),
  created_at timestamptz not null default now(),
  unique (source, external_id),
  check (stay_end >= stay_start)
);
create index reservations_property_idx on app.reservations (property_id);

create table app.api_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  token_hash bytea not null unique,
  scopes text[] not null check (cardinality(scopes) > 0 and scopes <@ array['content:write', 'reservations:write']::text[]),
  property_id uuid references app.properties (id) on delete cascade,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_used_at timestamptz
);
create index api_tokens_owner_idx on app.api_tokens (owner_id);

create table app.setup_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  property_id uuid references app.properties (id) on delete cascade,
  step text,
  created_at timestamptz not null default now()
);
create index setup_events_owner_idx on app.setup_events (owner_id);

create table app.guest_counters (
  property_id uuid not null references app.properties (id) on delete cascade,
  day date not null,
  link_exchanges integer not null default 0,
  guide_opens integer not null default 0,
  submissions integer not null default 0,
  primary key (property_id, day)
);

alter table app.properties owner to app_migrator;
alter table app.guide_sections owner to app_migrator;
alter table app.guide_translations owner to app_migrator;
alter table app.share_links owner to app_migrator;
alter table app.guest_sessions owner to app_migrator;
alter table app.guest_messages owner to app_migrator;
alter table app.rate_limits owner to app_migrator;
alter table app.audit_events owner to app_migrator;
alter table app.reservations owner to app_migrator;
alter table app.api_tokens owner to app_migrator;
alter table app.setup_events owner to app_migrator;
alter table app.guest_counters owner to app_migrator;
alter sequence app.audit_events_id_seq owner to app_migrator;
alter sequence app.setup_events_id_seq owner to app_migrator;

set role app_migrator;

-- Trusted server input set transaction-locally via set_config('app.owner_id', ..., true).
create function app.current_owner_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.owner_id', true), '')::uuid $$;

alter table app.properties enable row level security;
alter table app.guide_sections enable row level security;
alter table app.guide_translations enable row level security;
alter table app.share_links enable row level security;
alter table app.guest_sessions enable row level security;
alter table app.guest_messages enable row level security;
alter table app.rate_limits enable row level security;
alter table app.audit_events enable row level security;
alter table app.reservations enable row level security;
alter table app.api_tokens enable row level security;
alter table app.setup_events enable row level security;
alter table app.guest_counters enable row level security;

alter table app.properties force row level security;
alter table app.guide_sections force row level security;
alter table app.guide_translations force row level security;
alter table app.share_links force row level security;
alter table app.guest_sessions force row level security;
alter table app.guest_messages force row level security;
alter table app.rate_limits force row level security;
alter table app.audit_events force row level security;
alter table app.reservations force row level security;
alter table app.api_tokens force row level security;
alter table app.setup_events force row level security;
alter table app.guest_counters force row level security;

-- Host policies for the owner context; guest link-context policies arrive with the guest phases.
create policy properties_owner on app.properties
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());

create policy api_tokens_owner on app.api_tokens
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());

create policy setup_events_owner on app.setup_events
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());

-- Append-only for the runtime role: hosts read and append their own audit rows but never rewrite them.
create policy audit_events_read on app.audit_events
  for select using (actor_id = app.current_owner_id());

create policy audit_events_append on app.audit_events
  for insert with check (actor_id is not distinct from app.current_owner_id());

create policy guide_sections_owner on app.guide_sections for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

create policy guide_translations_owner on app.guide_translations for all
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
  );

create policy share_links_owner on app.share_links for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

create policy guest_sessions_owner on app.guest_sessions for all
  using (
    exists (
      select 1 from app.share_links l
      join app.properties p on p.id = l.property_id
      where l.id = share_link_id and p.owner_id = app.current_owner_id()
    )
  )
  with check (
    exists (
      select 1 from app.share_links l
      join app.properties p on p.id = l.property_id
      where l.id = share_link_id and p.owner_id = app.current_owner_id()
    )
  );

create policy guest_messages_owner on app.guest_messages for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

create policy guest_counters_owner on app.guest_counters for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

create policy reservations_owner on app.reservations for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

-- Fingerprint-only counters (no tenant or guest data), so runtime access is the boundary, not ownership.
create policy rate_limits_runtime on app.rate_limits for all using (true) with check (true);

grant select, insert, update, delete on all tables in schema app to app_runtime;
grant execute on function app.current_owner_id() to app_runtime;
grant usage on schema app to app_runtime;

revoke update, delete on app.audit_events from app_runtime;

-- Future tables created by the migration role stay private and ungranted until a migration grants explicitly.
alter default privileges in schema app revoke all on tables from public;
alter default privileges in schema app revoke all on sequences from public;
alter default privileges in schema app revoke all on functions from public;
alter default privileges in schema app revoke all on tables from anon, authenticated;
alter default privileges in schema app revoke all on sequences from anon, authenticated;
alter default privileges in schema app revoke all on functions from anon, authenticated;

revoke all on schema app from public, anon, authenticated;
revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;

reset role;
