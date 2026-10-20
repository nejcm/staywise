-- Guest features 4a: property essentials. Times are plain property columns; Wi-Fi and key-box
-- credentials live in an owner-only table because the guest property policy exposes whole rows.
set role app_migrator;

alter table app.properties add column checkin_time time;
alter table app.properties add column checkout_time time;

create table app.property_credentials (
  property_id uuid primary key references app.properties (id) on delete cascade,
  wifi_name text check (wifi_name is null or char_length(wifi_name) between 1 and 64),
  wifi_password text check (wifi_password is null or char_length(wifi_password) between 1 and 128),
  keybox_code text check (keybox_code is null or char_length(keybox_code) between 1 and 32),
  updated_at timestamptz not null default now()
);
alter table app.property_credentials enable row level security;
alter table app.property_credentials force row level security;
create policy property_credentials_owner on app.property_credentials for all
  using (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()))
  with check (exists (select 1 from app.properties p where p.id = property_id and p.owner_id = app.current_owner_id()));
grant select, insert, update, delete on app.property_credentials to app_runtime;

reset role;
