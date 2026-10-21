-- Stay links (ADR 0004): expiry holds in every policy that reads app.share_links, one live link per
-- stay, the property-link index ignores stays, and a stay link cannot point at another property.
begin;

create extension if not exists pgtap;

select plan(24);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

insert into auth.users (id, email) values ('5c5c0000-0000-4000-8000-0000000000a1', 'pgtap-stay@example.test');
insert into app.properties (id, owner_id, display_name, published) values
  ('5c5c0000-0000-4000-8000-0000000000a2', '5c5c0000-0000-4000-8000-0000000000a1', 'Stay A', true),
  ('5c5c0000-0000-4000-8000-0000000000b2', '5c5c0000-0000-4000-8000-0000000000a1', 'Stay B', true);
insert into app.property_credentials (property_id, wifi_password, keybox_code) values
  ('5c5c0000-0000-4000-8000-0000000000a2', 'pass-a', '1111');
insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end) values
  ('5c5c0000-0000-4000-8000-0000000000c1', '5c5c0000-0000-4000-8000-0000000000a2', 'manual', 'stay-live', current_date, current_date + 2),
  ('5c5c0000-0000-4000-8000-0000000000c2', '5c5c0000-0000-4000-8000-0000000000a2', 'manual', 'stay-over', current_date - 5, current_date - 2),
  ('5c5c0000-0000-4000-8000-0000000000c4', '5c5c0000-0000-4000-8000-0000000000a2', 'manual', 'stay-free', current_date, current_date);
insert into app.share_links (id, secret_hmac, property_id, kind, reservation_id, expires_at) values
  ('pgtapStayLive000001', '\x0102', '5c5c0000-0000-4000-8000-0000000000a2', 'stay', '5c5c0000-0000-4000-8000-0000000000c1', now() + interval '3 days'),
  ('pgtapStayOver000001', '\x0102', '5c5c0000-0000-4000-8000-0000000000a2', 'stay', '5c5c0000-0000-4000-8000-0000000000c2', now() - interval '1 second');
insert into app.share_links (id, secret_hmac, property_id) values
  ('pgtapStayProp000001', '\x0102', '5c5c0000-0000-4000-8000-0000000000a2');
insert into app.property_images (property_id, object_path, alt, width, height, bytes) values
  ('5c5c0000-0000-4000-8000-0000000000a2', '5c5c0000-0000-4000-8000-0000000000a2/hero.jpg', 'Hero', 1600, 1067, 1000);
insert into app.guest_counters (property_id, day, guide_opens) values
  ('5c5c0000-0000-4000-8000-0000000000a2', current_date - 1, 1);

create temp table probes (link text, name text, n integer) on commit drop;
grant insert on probes to app_runtime;

-- Each probe exercises one link-scoped policy as the runtime role inside the link context.
create function pg_temp.probe(p_link text) returns void language plpgsql as $$
declare
  v integer;
begin
  perform set_config('app.link_id', p_link, true);
  perform set_config('app.link_property_id', '5c5c0000-0000-4000-8000-0000000000a2', true);
  set local role app_runtime;
  insert into probes select p_link, 'share_links_guest_read', count(*)::integer from app.share_links;
  insert into probes select p_link, 'property_credentials_guest_read', count(*)::integer from app.property_credentials;
  insert into probes select p_link, 'guest_counters_guest_select', count(*)::integer from app.guest_counters;
  insert into probes select p_link, 'property_images_guest_read', count(*)::integer from app.property_images;
  update app.guest_counters set guide_opens = guide_opens + 1 where day = current_date - 1;
  get diagnostics v = row_count;
  insert into probes values (p_link, 'guest_counters_guest_update', v);
  begin
    insert into app.guest_counters (property_id, day, guide_opens)
    values ('5c5c0000-0000-4000-8000-0000000000a2', current_date, 1)
    on conflict (property_id, day) do nothing;
    insert into probes values (p_link, 'guest_counters_guest_insert', 1);
  exception when insufficient_privilege then
    insert into probes values (p_link, 'guest_counters_guest_insert', 0);
  end;
  begin
    insert into app.guest_messages (property_id, kind, body)
    values ('5c5c0000-0000-4000-8000-0000000000a2', 'question', 'Synthetic stay question');
    insert into probes values (p_link, 'guest_messages_guest_insert', 1);
  exception when insufficient_privilege then
    insert into probes values (p_link, 'guest_messages_guest_insert', 0);
  end;
  reset role;
end $$;

select pg_temp.probe('pgtapStayLive000001');
select pg_temp.probe('pgtapStayOver000001');

select is((select n from probes where link = 'pgtapStayLive000001' and name = 'share_links_guest_read'), 1, 'a live stay link reads its own row');
select is((select n from probes where link = 'pgtapStayLive000001' and name = 'property_credentials_guest_read'), 1, 'a live stay link reads credentials');
select is((select n from probes where link = 'pgtapStayLive000001' and name = 'guest_counters_guest_select'), 1, 'a live stay link reads counters');
select is((select n from probes where link = 'pgtapStayLive000001' and name = 'property_images_guest_read'), 1, 'a live stay link reads the hero');
select is((select n from probes where link = 'pgtapStayLive000001' and name = 'guest_counters_guest_update'), 1, 'a live stay link bumps counters');
select is((select n from probes where link = 'pgtapStayLive000001' and name = 'guest_counters_guest_insert'), 1, 'a live stay link inserts counters');
select is((select n from probes where link = 'pgtapStayLive000001' and name = 'guest_messages_guest_insert'), 1, 'a live stay link submits messages');
select is((select n from probes where link = 'pgtapStayOver000001' and name = 'share_links_guest_read'), 0, 'share_links_guest_read hides an expired link');
select is((select n from probes where link = 'pgtapStayOver000001' and name = 'property_credentials_guest_read'), 0, 'property_credentials_guest_read denies an expired link');
select is((select n from probes where link = 'pgtapStayOver000001' and name = 'guest_counters_guest_select'), 0, 'guest_counters_guest_select denies an expired link');
select is((select n from probes where link = 'pgtapStayOver000001' and name = 'property_images_guest_read'), 0, 'property_images_guest_read denies an expired link');
select is((select n from probes where link = 'pgtapStayOver000001' and name = 'guest_counters_guest_update'), 0, 'guest_counters_guest_update denies an expired link');
select is((select n from probes where link = 'pgtapStayOver000001' and name = 'guest_counters_guest_insert'), 0, 'guest_counters_guest_insert denies an expired link');
select is((select n from probes where link = 'pgtapStayOver000001' and name = 'guest_messages_guest_insert'), 0, 'guest_messages_guest_insert denies an expired link');

-- The one remaining policy that reads app.share_links is owner-scoped; expiry must not hide links from the host.
create function pg_temp.owner_probe() returns integer language plpgsql as $$
declare
  v integer;
begin
  perform set_config('app.owner_id', '5c5c0000-0000-4000-8000-0000000000a1', true);
  set local role app_runtime;
  insert into app.guest_sessions (session_hash, share_link_id, expires_at)
  values ('\x33', 'pgtapStayOver000001', now() + interval '1 hour');
  select count(*)::integer into v from app.share_links where id = 'pgtapStayOver000001';
  reset role;
  return v;
end $$;
select is(pg_temp.owner_probe(), 1, 'share_links_owner and guest_sessions_owner still serve the host an expired link');
select is((select count(*)::integer from pg_policies where schemaname = 'app' and (qual like '%app.share_links%' or with_check like '%app.share_links%')), 7, 'seven policies read app.share_links in a subquery; each is probed above');

select throws_ok(
  $$insert into app.share_links (id, secret_hmac, property_id) values ('pgtapStayProp000002', '\x0102', '5c5c0000-0000-4000-8000-0000000000a2')$$,
  '23505', null, 'the property keeps one enabled property link');
select lives_ok(
  $$insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end) values ('5c5c0000-0000-4000-8000-0000000000c3', '5c5c0000-0000-4000-8000-0000000000a2', 'manual', 'stay-two', current_date, current_date);
    insert into app.share_links (id, secret_hmac, property_id, kind, reservation_id, expires_at) values ('pgtapStayTwo0000001', '\x0102', '5c5c0000-0000-4000-8000-0000000000a2', 'stay', '5c5c0000-0000-4000-8000-0000000000c3', now() + interval '1 day')$$,
  'stay links live beside the enabled property link');
select throws_ok(
  $$insert into app.share_links (id, secret_hmac, property_id, kind, reservation_id, expires_at) values ('pgtapStayTwo0000002', '\x0102', '5c5c0000-0000-4000-8000-0000000000a2', 'stay', '5c5c0000-0000-4000-8000-0000000000c3', now() + interval '1 day')$$,
  '23505', null, 'one live link per stay');
select throws_ok(
  $$insert into app.share_links (id, secret_hmac, property_id, kind) values ('pgtapStayBad0000001', '\x0102', '5c5c0000-0000-4000-8000-0000000000b2', 'stay')$$,
  '23514', null, 'a stay link needs a reservation and an expiry');
select throws_ok(
  $$insert into app.share_links (id, secret_hmac, property_id, reservation_id, expires_at) values ('pgtapStayBad0000002', '\x0102', '5c5c0000-0000-4000-8000-0000000000b2', '5c5c0000-0000-4000-8000-0000000000c3', now())$$,
  '23514', null, 'a property link carries no reservation or expiry');
select throws_ok(
  $$insert into app.share_links (id, secret_hmac, property_id, kind, reservation_id, expires_at) values ('pgtapStayBad0000003', '\x0102', '5c5c0000-0000-4000-8000-0000000000b2', 'stay', '5c5c0000-0000-4000-8000-0000000000c4', now() + interval '1 day')$$,
  '23503', null, 'a stay link cannot point at another property''s reservation');

delete from app.reservations where id = '5c5c0000-0000-4000-8000-0000000000c2';
select is((select count(*)::integer from app.share_links where id = 'pgtapStayOver000001'), 0, 'deleting the reservation removes its stay link');
select is((select count(*)::integer from app.guest_sessions where share_link_id = 'pgtapStayOver000001'), 0, 'and its sessions');

select * from finish();
rollback;
