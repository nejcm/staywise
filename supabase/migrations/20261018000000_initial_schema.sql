-- Private application schema; never exposed through the Data API (implementation_plan.md §4).
create schema if not exists app;

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
  updated_at timestamptz not null default now(),
  -- Keep in step with guestLocales in guide-validation.ts; the source locale is always available to guests.
  enabled_locales text[] not null default '{}',
  -- The host's sign-in address receives the minimal new-message alert; guests never see it.
  alert_email text,
  checkin_time time,
  checkout_time time,
  -- Not a credential, so it is guest-readable through properties_guest_read and never translated.
  address text check (address is null or char_length(address) between 1 and 200),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  answer_from time,
  answer_to time,
  -- Theme keys are permanent because stored rows reference them.
  theme text not null default 'staywise' check (theme in ('staywise', 'coast', 'alpine', 'terracotta', 'classic')),
  constraint properties_locales_check check (
    source_locale in ('en', 'de', 'sl', 'fr', 'es')
    and enabled_locales <@ array['en', 'de', 'sl', 'fr', 'es']::text[]
    and cardinality(enabled_locales) <= 3
  ),
  constraint properties_answer_hours_paired check ((answer_from is null) = (answer_to is null))
);
create index properties_owner_idx on app.properties (owner_id);

-- Per-host defaults copied into a property at creation; checks mirror app.properties.
create table app.host_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'staywise' check (theme in ('staywise', 'coast', 'alpine', 'terracotta', 'classic')),
  source_locale text not null default 'en',
  enabled_locales text[] not null default '{}',
  timezone text not null default 'UTC',
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  answer_from time,
  answer_to time,
  checkin_time time,
  checkout_time time,
  updated_at timestamptz not null default now(),
  constraint host_settings_locales_check check (
    source_locale in ('en', 'de', 'sl', 'fr', 'es')
    and enabled_locales <@ array['en', 'de', 'sl', 'fr', 'es']::text[]
    and cardinality(enabled_locales) <= 3
  ),
  constraint host_settings_answer_hours_paired check ((answer_from is null) = (answer_to is null))
);

-- Wi-Fi and key-box credentials live in an owner-only table because the guest property policy exposes whole rows.
create table app.property_credentials (
  property_id uuid primary key references app.properties (id) on delete cascade,
  wifi_name text check (wifi_name is null or char_length(wifi_name) between 1 and 64),
  wifi_password text check (wifi_password is null or char_length(wifi_password) between 1 and 128),
  keybox_code text check (keybox_code is null or char_length(keybox_code) between 1 and 32),
  updated_at timestamptz not null default now()
);

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
  updated_at timestamptz not null default now(),
  secret_value text,
  -- Structured secret values are host-side only: a guest-visible section can never carry one.
  constraint guide_sections_secret_host_only check (secret_value is null or visibility = 'host')
);
create index guide_sections_property_idx on app.guide_sections (property_id);

-- A stored translation binds to the source revision and source language it was generated from.
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
  source_locale text not null default 'en',
  unique (section_id, locale),
  constraint guide_translations_source_check check (
    locale in ('en', 'de', 'sl', 'fr', 'es') and source_locale in ('en', 'de', 'sl', 'fr', 'es')
  )
);

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
  check (stay_end >= stay_start),
  constraint reservations_id_property_key unique (id, property_id)
);
create index reservations_property_idx on app.reservations (property_id);

-- A stay link belongs to one reservation and expires (ADR 0004); a disabled row keeps metadata only.
create table app.share_links (
  id text primary key,
  secret_hmac bytea,
  property_id uuid not null references app.properties (id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  kind text not null default 'property' check (kind in ('property', 'stay')),
  reservation_id uuid,
  expires_at timestamptz,
  constraint share_links_state_check check (enabled = (disabled_at is null and secret_hmac is not null)),
  constraint share_links_id_check check (id ~ '^[A-Za-z0-9_-]{16,64}$'),
  -- Composite key: a stay link can only point at a reservation of its own property.
  constraint share_links_reservation_fkey foreign key (reservation_id, property_id)
    references app.reservations (id, property_id) on delete cascade,
  constraint share_links_stay_check check ((kind = 'stay') = (reservation_id is not null and expires_at is not null))
);
create index share_links_property_idx on app.share_links (property_id);
create unique index share_links_one_enabled_idx on app.share_links (property_id) where enabled and kind = 'property';
create unique index share_links_one_enabled_stay_idx on app.share_links (reservation_id) where enabled;

create table app.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  session_hash bytea not null unique,
  share_link_id text not null references app.share_links (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index guest_sessions_link_idx on app.guest_sessions (share_link_id);

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
  created_at timestamptz not null default now(),
  locale text not null default 'en' check (locale in ('en', 'de', 'sl', 'fr', 'es')),
  -- Bounded input is enforced at the canonical boundary; these constraints keep direct writers honest.
  constraint guest_messages_body_len_check check (char_length(body) between 1 and 2000),
  constraint guest_messages_email_len_check check (follow_up_email is null or char_length(follow_up_email) <= 254),
  constraint guest_messages_handled_check check ((state = 'handled') = (handled_at is not null)),
  constraint guest_messages_answer_tag_check check (answer_in_guide is null or kind = 'question')
);
create index guest_messages_property_created_idx on app.guest_messages (property_id, created_at desc);

create table app.guest_counters (
  property_id uuid not null references app.properties (id) on delete cascade,
  day date not null,
  link_exchanges integer not null default 0,
  guide_opens integer not null default 0,
  submissions integer not null default 0,
  primary key (property_id, day)
);

-- Property deletion removes every property-scoped rate-limit fingerprint.
create table app.rate_limits (
  key_hash bytea not null,
  window_start timestamptz not null,
  count integer not null default 1,
  property_id uuid not null,
  primary key (key_hash, window_start),
  constraint rate_limits_property_fk foreign key (property_id) references app.properties (id) on delete cascade
);
create index rate_limits_window_idx on app.rate_limits (window_start);
create index rate_limits_property_idx on app.rate_limits (property_id);

-- Auth sees every OTP call from the server's egress IP, so these windows key on HMACs of the client
-- IP and of the address instead, carry no tenant, and are purged with the other rate windows.
create table app.auth_rate_limits (
  key_hash bytea not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (key_hash, window_start)
);
create index auth_rate_limits_window_idx on app.auth_rate_limits (window_start);

create table app.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (
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
      'stay_link_revoked'
    )
  ),
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on app.audit_events (created_at);

create table app.setup_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (
    event_type in (
      'sign_in',
      'property_created',
      'section_saved',
      'preview_opened',
      'publish_clicked',
      'support_requested',
      'gap_section_added'
    )
  ),
  property_id uuid references app.properties (id) on delete cascade,
  step text,
  created_at timestamptz not null default now()
);
create index setup_events_owner_idx on app.setup_events (owner_id);

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

alter table app.properties owner to app_migrator;
alter table app.host_settings owner to app_migrator;
alter table app.property_credentials owner to app_migrator;
alter table app.guide_sections owner to app_migrator;
alter table app.guide_translations owner to app_migrator;
alter table app.reservations owner to app_migrator;
alter table app.share_links owner to app_migrator;
alter table app.guest_sessions owner to app_migrator;
alter table app.guest_messages owner to app_migrator;
alter table app.guest_counters owner to app_migrator;
alter table app.rate_limits owner to app_migrator;
alter table app.auth_rate_limits owner to app_migrator;
alter table app.audit_events owner to app_migrator;
alter table app.setup_events owner to app_migrator;
alter table app.api_tokens owner to app_migrator;
alter sequence app.audit_events_id_seq owner to app_migrator;
alter sequence app.setup_events_id_seq owner to app_migrator;

set role app_migrator;

-- Trusted server input set transaction-locally via set_config('app.owner_id', ..., true).
create function app.current_owner_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.owner_id', true), '')::uuid $$;

-- The app sets app.link_id from the request and app.link_property_id after it has validated the
-- session against the link row.
create function app.current_link_id() returns text
language sql stable
as $$ select nullif(current_setting('app.link_id', true), '') $$;

create function app.current_link_property_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.link_property_id', true), '')::uuid $$;

alter table app.properties enable row level security;
alter table app.host_settings enable row level security;
alter table app.property_credentials enable row level security;
alter table app.guide_sections enable row level security;
alter table app.guide_translations enable row level security;
alter table app.reservations enable row level security;
alter table app.share_links enable row level security;
alter table app.guest_sessions enable row level security;
alter table app.guest_messages enable row level security;
alter table app.guest_counters enable row level security;
alter table app.rate_limits enable row level security;
alter table app.auth_rate_limits enable row level security;
alter table app.audit_events enable row level security;
alter table app.setup_events enable row level security;
alter table app.api_tokens enable row level security;

alter table app.properties force row level security;
alter table app.host_settings force row level security;
alter table app.property_credentials force row level security;
alter table app.guide_sections force row level security;
alter table app.guide_translations force row level security;
alter table app.reservations force row level security;
alter table app.share_links force row level security;
alter table app.guest_sessions force row level security;
alter table app.guest_messages force row level security;
alter table app.guest_counters force row level security;
alter table app.rate_limits force row level security;
alter table app.auth_rate_limits force row level security;
alter table app.audit_events force row level security;
alter table app.setup_events force row level security;
alter table app.api_tokens force row level security;

create policy properties_owner on app.properties
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());

create policy properties_guest_read on app.properties for select
  using (id = app.current_link_property_id() and published);

create policy host_settings_owner on app.host_settings
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());

create policy property_credentials_owner on app.property_credentials for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

-- The link row is rechecked so a disabled or rotated link reads nothing even with a stale property context.
create policy property_credentials_guest_read on app.property_credentials for select
  using (
    property_id = app.current_link_property_id()
    and exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id() and l.enabled and l.secret_hmac is not null and l.property_id = property_credentials.property_id
    )
    and exists (select 1 from app.properties p where p.id = property_credentials.property_id and p.published)
  );

create policy guide_sections_owner on app.guide_sections for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

create policy guide_sections_guest_read on app.guide_sections for select
  using (
    published
    and visibility = 'guest'
    and property_id = app.current_link_property_id()
    and exists (select 1 from app.properties p where p.id = property_id and p.published)
  );

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

-- Guests read only approved translations whose binding still matches the live section and
-- property: unreviewed, stale, host-only, unpublished, disabled-locale, and cross-property rows stay invisible.
create policy guide_translations_guest_read on app.guide_translations for select
  using (
    state = 'approved'
    and exists (
      select 1 from app.guide_sections s
      join app.properties p on p.id = s.property_id
      where s.id = section_id
        and s.property_id = app.current_link_property_id()
        and s.published
        and s.visibility = 'guest'
        and p.published
        and guide_translations.source_revision = s.source_revision
        and guide_translations.source_locale = p.source_locale
        and guide_translations.locale = any (p.enabled_locales)
    )
  );

create policy reservations_owner on app.reservations for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

create policy share_links_owner on app.share_links for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

-- Every link-scoped policy reads app.share_links through this policy, so expiry applies to all of them.
create policy share_links_guest_read on app.share_links for select
  using (
    id = app.current_link_id() and enabled and secret_hmac is not null and (expires_at is null or expires_at > now())
  );

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

create policy guest_sessions_guest on app.guest_sessions for all
  using (share_link_id = app.current_link_id())
  with check (share_link_id = app.current_link_id());

create policy guest_messages_owner on app.guest_messages for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

-- Guests may only insert into the link's own published property; they never read, update, or delete stored messages.
create policy guest_messages_guest_insert on app.guest_messages for insert
  with check (
    property_id = app.current_link_property_id()
    and exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_messages.property_id
    )
    and exists (select 1 from app.properties p where p.id = guest_messages.property_id and p.published)
  );

create policy guest_counters_owner on app.guest_counters for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));

-- Aggregate counters are host data guests only bump: link-scoped so every write lands on the
-- link's own property, never another host's.
create policy guest_counters_guest_insert on app.guest_counters for insert
  with check (
    exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_counters.property_id
    )
  );
create policy guest_counters_guest_select on app.guest_counters for select
  using (
    exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_counters.property_id
    )
  );
create policy guest_counters_guest_update on app.guest_counters for update
  using (
    exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_counters.property_id
    )
  )
  with check (
    exists (
      select 1 from app.share_links l
      where l.id = app.current_link_id()
        and l.enabled
        and l.secret_hmac is not null
        and l.property_id = guest_counters.property_id
    )
  );

-- Fingerprint-only counters (no tenant or guest data), so runtime access is the boundary, not ownership.
create policy rate_limits_runtime on app.rate_limits for all using (true) with check (true);
create policy auth_rate_limits_runtime on app.auth_rate_limits for all to app_runtime using (true) with check (true);

-- Append-only for the runtime role: hosts read and append their own audit rows but never rewrite them.
create policy audit_events_read on app.audit_events
  for select using (actor_id = app.current_owner_id());

create policy audit_events_append on app.audit_events
  for insert with check (actor_id is not distinct from app.current_owner_id());

create policy setup_events_owner on app.setup_events
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());

create policy api_tokens_owner on app.api_tokens
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());

-- Retention clock: every cutoff derives from the explicit boundary (default now()), strict `<` keeps
-- a row exactly at the boundary for the full window. Messages expire 90 days after receipt (host
-- deletion is the earlier route), audit and setup events after 90 days, reservations 90 days after
-- the stay's UTC end date, disabled-link metadata after 30 days, guest sessions once expired, rate
-- windows before the boundary's UTC day start, and guest counter days after 400 days (a year of
-- year-over-year comparison plus slack); translations are removed by property deletion, never by age.
create function app.retention_cleanup(p_now timestamptz default now()) returns jsonb
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

-- These tables force RLS even for their owner. A DELETE ... WHERE also reads the rows it targets, so
-- the definer function needs both sides; the age boundary stays in the function, the only granted caller.
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
create policy auth_rate_limits_retention_select on app.auth_rate_limits for select to app_migrator using (true);
create policy auth_rate_limits_retention_delete on app.auth_rate_limits for delete to app_migrator using (true);
create policy guest_counters_retention_select on app.guest_counters for select to app_migrator using (true);
create policy guest_counters_retention_delete on app.guest_counters for delete to app_migrator using (true);

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
-- The runtime role must not be able to purge rows across tenants, so retention_cleanup stays ungranted.
revoke all on all functions in schema app from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema app to app_runtime;
revoke update, delete on app.audit_events from app_runtime;
revoke delete on app.host_settings from app_runtime;
grant execute on function app.current_owner_id() to app_runtime;
grant execute on function app.current_link_id() to app_runtime;
grant execute on function app.current_link_property_id() to app_runtime;

reset role;

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
