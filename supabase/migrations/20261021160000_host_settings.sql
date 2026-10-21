-- Host settings: per-host defaults copied into a property at creation; checks mirror app.properties.
-- Created by the runner because only it holds REFERENCES on auth.users; ownership moves below.
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
revoke all on app.host_settings from public, anon, authenticated;
alter table app.host_settings owner to app_migrator;

set role app_migrator;

alter table app.host_settings enable row level security;
alter table app.host_settings force row level security;
create policy host_settings_owner on app.host_settings
  for all using (owner_id = app.current_owner_id()) with check (owner_id = app.current_owner_id());
grant select, insert, update on app.host_settings to app_runtime;

reset role;
