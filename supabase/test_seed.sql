-- Local-only synthetic data for trying the app. Not loaded by db reset (see supabase/config.toml).
-- Load on a migrated local DB:  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/test_seed.sql
-- Idempotent: fixed ids, re-runs do nothing. Guest links: /g/<id>#<secret>
--   /g/bledtestlink000001#TestLakeHouseSecret0123456789abcdefghijklmn   (Bled, published)
--   /g/ljubljanatestlink01#TestPiranSecret0123456789abcdefghijklmnopqr  (Ljubljana, published)
-- The old Piran link is disabled on purpose. Bled (bbbbbbbb-…0001) is the fully filled-in property.
begin;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, encrypted_password)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maria-host@example.test', now(), '{"provider":"email","providers":["email"]}', '{"email_verified":true}', now(), now(), '', '', '', '', ''),
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tomaz-host@example.test', now(), '{"provider":"email","providers":["email"]}', '{"email_verified":true}', now(), now(), '', '', '', '', ''),
  ('aaaaaaaa-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jana-host@example.test', now(), '{"provider":"email","providers":["email"]}', '{"email_verified":true}', now(), now(), '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now()
from auth.users u
where u.id in ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003')
on conflict do nothing;

insert into app.properties (id, owner_id, display_name, timezone, source_locale, published, enabled_locales)
values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Bled lakeside apartment', 'Europe/Ljubljana', 'en', true, '{de,sl}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Piran sea-view flat', 'Europe/Ljubljana', 'en', false, '{}'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002', 'Ljubljana city loft', 'Europe/Ljubljana', 'en', true, '{de}'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000003', 'Kranj family house', 'Europe/Ljubljana', 'en', false, '{}')
on conflict (id) do nothing;

insert into app.guide_sections (id, property_id, category, title, body, visibility, display_order, source_revision, published, secret_value)
values
  ('cccccccc-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000001', 'arrival', 'Getting in', 'Use the code we sent 24 hours before arrival. Parking is in front of the house.', 'guest', 1, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000102', 'bbbbbbbb-0000-4000-8000-000000000001', 'wifi', 'Wi-Fi', 'Network: Bled-Lake-5G. The password is on the router label.', 'guest', 2, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000103', 'bbbbbbbb-0000-4000-8000-000000000001', 'parking', 'Parking', 'One space included. A second car fits on the gravel strip by the shed.', 'guest', 3, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000104', 'bbbbbbbb-0000-4000-8000-000000000001', 'appliances', 'Dishwasher', 'Pods go in the drawer. If it shows E24, press Start once to drain.', 'guest', 4, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000105', 'bbbbbbbb-0000-4000-8000-000000000001', 'arrival', 'Key box code', 'Host only: key box is by the side door.', 'host', 5, 1, true, '4821'),
  ('cccccccc-0000-4000-8000-000000000106', 'bbbbbbbb-0000-4000-8000-000000000001', 'local_tips', 'Around the lake', 'Walk to the island in the morning. Rowing boats are at the boathouse.', 'guest', 6, 1, false, null),
  ('cccccccc-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000002', 'arrival', 'Getting in', 'Ring the bell marked Flat 3. The code arrives by email.', 'guest', 1, 1, false, null),
  ('cccccccc-0000-4000-8000-000000000202', 'bbbbbbbb-0000-4000-8000-000000000002', 'wifi', 'Wi-Fi', 'Network: Piran-Sea. Password is on the fridge.', 'guest', 2, 1, false, null),
  ('cccccccc-0000-4000-8000-000000000203', 'bbbbbbbb-0000-4000-8000-000000000002', 'rules', 'House rules', 'No parties. Quiet after 22:00.', 'guest', 3, 1, false, null),
  ('cccccccc-0000-4000-8000-000000000301', 'bbbbbbbb-0000-4000-8000-000000000003', 'arrival', 'Getting in', 'Self check-in with the keypad at the front door. Code is in your booking message.', 'guest', 1, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000302', 'bbbbbbbb-0000-4000-8000-000000000003', 'emergency', 'Emergencies', 'Fire extinguisher under the sink. Emergency number 112.', 'guest', 2, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000303', 'bbbbbbbb-0000-4000-8000-000000000003', 'local_tips', 'Cafés nearby', 'Try the bakery on the corner. Open from 07:00.', 'guest', 3, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000401', 'bbbbbbbb-0000-4000-8000-000000000004', 'rules', 'House rules', 'No shoes inside. Smoking outside only.', 'guest', 1, 1, false, null),
  ('cccccccc-0000-4000-8000-000000000402', 'bbbbbbbb-0000-4000-8000-000000000004', 'waste', 'Rubbish and recycling', 'Bins are collected on Tuesdays. Yellow bin is for plastics.', 'guest', 2, 1, false, null)
on conflict (id) do nothing;

insert into app.guide_translations (id, section_id, locale, title, body, source_revision, state, source_locale, provider, reviewed_at)
values
  ('dddddddd-0000-4000-8000-000000000101', 'cccccccc-0000-4000-8000-000000000101', 'de', 'Anreise', 'Nutzen Sie den Code, den wir 24 Stunden vor der Ankunft geschickt haben. Parken Sie vor dem Haus.', 1, 'approved', 'en', 'test-seed', now()),
  ('dddddddd-0000-4000-8000-000000000102', 'cccccccc-0000-4000-8000-000000000102', 'de', 'WLAN', 'Netzwerk: Bled-Lake-5G. Das Passwort steht auf dem Router-Etikett.', 1, 'approved', 'en', 'test-seed', now()),
  ('dddddddd-0000-4000-8000-000000000103', 'cccccccc-0000-4000-8000-000000000101', 'sl', 'Prihod', 'Uporabite kodo, ki smo jo poslali 24 ur pred prihodom.', 1, 'draft', 'en', 'test-seed', null),
  ('dddddddd-0000-4000-8000-000000000301', 'cccccccc-0000-4000-8000-000000000301', 'de', 'Anreise', 'Selbst-Check-in über das Tastenfeld an der Haustür. Der Code steht in Ihrer Buchungsnachricht.', 1, 'approved', 'en', 'test-seed', now())
on conflict (id) do nothing;

insert into app.share_links (id, secret_hmac, property_id, enabled, disabled_at)
values
  ('bledtestlink000001', '\x19539fffdf20804d7eb3603884a35ce650e9ccb9347ade3f180fa43e382a81ed', 'bbbbbbbb-0000-4000-8000-000000000001', true, null),
  ('ljubljanatestlink01', '\x2360e7e48ff98134a8bdb0ed3d7b61e55d18136e99b2930d233301ea443ea0f6', 'bbbbbbbb-0000-4000-8000-000000000003', true, null),
  ('piranoldlink000001', null, 'bbbbbbbb-0000-4000-8000-000000000002', false, '2026-10-01 10:00+00')
on conflict (id) do nothing;

insert into app.guest_messages (id, property_id, kind, category, body, follow_up_email, state, answer_in_guide, handled_at, created_at, locale)
values
  ('eeeeeeee-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000001', 'question', 'wifi', 'Hallo! Wo finde ich das WLAN-Passwort?', null, 'new', null, null, '2026-10-16 18:00+00', 'de'),
  ('eeeeeeee-0000-4000-8000-000000000102', 'bbbbbbbb-0000-4000-8000-000000000001', 'issue', 'appliances', 'The dishwasher shows E24 and will not drain.', 'guest.one@example.test', 'handled', null, '2026-10-17 09:00+00', '2026-10-16 20:30+00', 'en'),
  ('eeeeeeee-0000-4000-8000-000000000103', 'bbbbbbbb-0000-4000-8000-000000000001', 'question', 'parking', 'Is there room for a second car?', null, 'handled', true, '2026-10-17 09:05+00', '2026-10-17 08:10+00', 'en'),
  ('eeeeeeee-0000-4000-8000-000000000104', 'bbbbbbbb-0000-4000-8000-000000000003', 'issue', null, 'Hot water runs out after five minutes.', 'guest.two@example.test', 'new', null, null, '2026-10-18 07:45+00', 'en')
on conflict (id) do nothing;

insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end, guest_first_name, locale, party_size)
values
  ('ffffffff-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000001', 'airbnb', 'HMTEST0001', '2026-11-01', '2026-11-05', 'Lena', 'de', 2),
  ('ffffffff-0000-4000-8000-000000000102', 'bbbbbbbb-0000-4000-8000-000000000001', 'booking', 'BK-TEST-0002', '2026-11-10', '2026-11-12', 'Marco', 'sl', 3),
  ('ffffffff-0000-4000-8000-000000000103', 'bbbbbbbb-0000-4000-8000-000000000003', 'airbnb', 'HMTEST0003', '2026-12-01', '2026-12-03', 'Sam', 'en', 1)
on conflict (id) do nothing;

-- Bled lakeside apartment: the fully filled-in property (essentials, every category, translations, inbox, stays).
update app.properties set
  checkin_time = '15:00', checkout_time = '10:30',
  address = 'Cesta svobode 12, 4260 Bled, Slovenia',
  contact_phone = '+38640123456', answer_from = '08:00', answer_to = '21:00'
where id = 'bbbbbbbb-0000-4000-8000-000000000001';

insert into app.property_credentials (property_id, wifi_name, wifi_password, keybox_code)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'Bled-Lake-5G', 'LakeView-2026-test', '4821')
on conflict (property_id) do nothing;

insert into app.guide_sections (id, property_id, category, title, body, visibility, display_order, source_revision, published, secret_value)
values
  ('cccccccc-0000-4000-8000-000000000107', 'bbbbbbbb-0000-4000-8000-000000000001', 'arrival', 'Late arrival', 'Arriving after 22:00? Message us and we will leave the porch light on. The key box is by the side door, the code is under Essentials.', 'guest', 7, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000108', 'bbbbbbbb-0000-4000-8000-000000000001', 'rules', 'House rules', E'Quiet hours are 22:00 to 07:00.\nNo smoking indoors; the balcony is fine.\nNo parties or events.\nPets are welcome with prior notice.', 'guest', 8, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000109', 'bbbbbbbb-0000-4000-8000-000000000001', 'rules', 'Fireplace and sauna', 'Firewood is in the shed. Please let the fire die out before leaving. The sauna needs 40 minutes to heat; switch it off afterwards.', 'guest', 9, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000110', 'bbbbbbbb-0000-4000-8000-000000000001', 'appliances', 'Heating and hot water', 'Underfloor heating is set by the thermostat in the hall. The boiler holds 120 litres; allow 30 minutes between long showers.', 'guest', 10, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000111', 'bbbbbbbb-0000-4000-8000-000000000001', 'appliances', 'Coffee machine', 'Capsules are in the top drawer. Fill the tank, press the left button once to rinse, then brew.', 'guest', 11, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000112', 'bbbbbbbb-0000-4000-8000-000000000001', 'waste', 'Rubbish and recycling', 'Bins are behind the shed: yellow for plastics, blue for paper, green for glass, black for the rest. Collection is on Mondays.', 'guest', 12, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000113', 'bbbbbbbb-0000-4000-8000-000000000001', 'checkout', 'Before you leave', E'Checkout is by 10:30.\nStart the dishwasher and take out the rubbish.\nClose all windows and switch off the sauna.\nLeave the key in the key box.', 'guest', 13, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000114', 'bbbbbbbb-0000-4000-8000-000000000001', 'emergency', 'Emergencies', E'General emergency: 112.\nNearest pharmacy: Lekarna Bled, 5 minutes by car.\nHost phone: see Essentials.', 'guest', 14, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000115', 'bbbbbbbb-0000-4000-8000-000000000001', 'local_tips', 'Where to eat', 'Try the cream cake at the lakeside café, and book the gostilna in the village a day ahead for dinner.', 'guest', 15, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000116', 'bbbbbbbb-0000-4000-8000-000000000001', 'local_tips', 'Hikes and swimming', 'Ojstrica viewpoint is a 40-minute walk. The nearest free swimming spot is the meadow 300 m left of the boathouse.', 'guest', 16, 1, true, null),
  ('cccccccc-0000-4000-8000-000000000117', 'bbbbbbbb-0000-4000-8000-000000000001', 'wifi', 'Wi-Fi trouble', 'If the connection drops, unplug the router for ten seconds. The router lives in the hall cupboard.', 'guest', 17, 1, false, null),
  ('cccccccc-0000-4000-8000-000000000118', 'bbbbbbbb-0000-4000-8000-000000000001', 'emergency', 'Plumber and electrician', 'Host only: Janez (plumber) 040 555 010, Mitja (electrician) 040 555 020.', 'host', 18, 1, true, 'Janez 040 555 010 / Mitja 040 555 020')
on conflict (id) do nothing;

insert into app.guide_translations (id, section_id, locale, title, body, source_revision, state, source_locale, provider, reviewed_at)
values
  ('dddddddd-0000-4000-8000-000000000104', 'cccccccc-0000-4000-8000-000000000103', 'de', 'Parken', 'Ein Stellplatz ist inbegriffen. Ein zweites Auto passt auf den Kiesstreifen neben dem Schuppen.', 1, 'approved', 'en', 'test-seed', now()),
  ('dddddddd-0000-4000-8000-000000000105', 'cccccccc-0000-4000-8000-000000000108', 'de', 'Hausregeln', E'Ruhezeiten: 22:00 bis 07:00.\nKein Rauchen im Haus; auf dem Balkon ist es erlaubt.\nKeine Partys oder Veranstaltungen.\nHaustiere sind nach Absprache willkommen.', 1, 'approved', 'en', 'test-seed', now()),
  ('dddddddd-0000-4000-8000-000000000106', 'cccccccc-0000-4000-8000-000000000113', 'de', 'Vor der Abreise', E'Check-out bis 10:30.\nSpülmaschine starten und den Müll rausbringen.\nAlle Fenster schließen und die Sauna ausschalten.\nSchlüssel in die Schlüsselbox legen.', 1, 'approved', 'en', 'test-seed', now()),
  ('dddddddd-0000-4000-8000-000000000107', 'cccccccc-0000-4000-8000-000000000114', 'de', 'Notfälle', E'Allgemeiner Notruf: 112.\nNächste Apotheke: Lekarna Bled, 5 Minuten mit dem Auto.', 1, 'draft', 'en', 'test-seed', null),
  ('dddddddd-0000-4000-8000-000000000108', 'cccccccc-0000-4000-8000-000000000102', 'sl', 'Wi-Fi', 'Omrežje: Bled-Lake-5G. Geslo je na nalepki na usmerjevalniku.', 1, 'approved', 'en', 'test-seed', now()),
  ('dddddddd-0000-4000-8000-000000000109', 'cccccccc-0000-4000-8000-000000000108', 'sl', 'Hišni red', E'Ure miru: od 22:00 do 07:00.\nKajenje v hiši ni dovoljeno, na balkonu je.\nBrez zabav in dogodkov.', 1, 'approved', 'en', 'test-seed', now()),
  ('dddddddd-0000-4000-8000-000000000110', 'cccccccc-0000-4000-8000-000000000113', 'sl', 'Pred odhodom', E'Odjava do 10:30.\nZaženite pomivalni stroj in odnesite smeti.\nZaprite vsa okna in izklopite savno.\nKljuč pustite v omarici za ključe.', 1, 'draft', 'en', 'test-seed', null),
  ('dddddddd-0000-4000-8000-000000000111', 'cccccccc-0000-4000-8000-000000000112', 'sl', 'Odpadki', 'Zabojniki so za lopo: rumen za plastiko, moder za papir, zelen za steklo, črn za ostalo. Odvoz je ob ponedeljkih.', 0, 'approved', 'en', 'test-seed', now())
on conflict (id) do nothing;

insert into app.guest_messages (id, property_id, kind, category, body, follow_up_email, state, answer_in_guide, handled_at, created_at, locale)
values
  ('eeeeeeee-0000-4000-8000-000000000105', 'bbbbbbbb-0000-4000-8000-000000000001', 'question', 'arrival', 'We land at midnight. Is a very late check-in possible?', 'guest.late@example.test', 'new', null, null, '2026-10-19 21:15+00', 'en'),
  ('eeeeeeee-0000-4000-8000-000000000106', 'bbbbbbbb-0000-4000-8000-000000000001', 'question', 'rules', 'Dürfen wir unseren Hund mitbringen?', null, 'new', null, null, '2026-10-20 07:30+00', 'de'),
  ('eeeeeeee-0000-4000-8000-000000000107', 'bbbbbbbb-0000-4000-8000-000000000001', 'issue', 'appliances', 'Savna se ne segreje.', 'gost.sl@example.test', 'new', null, null, '2026-10-20 18:05+00', 'sl'),
  ('eeeeeeee-0000-4000-8000-000000000108', 'bbbbbbbb-0000-4000-8000-000000000001', 'question', 'local_tips', 'Which restaurant do you recommend for dinner?', null, 'handled', true, '2026-10-18 10:00+00', '2026-10-18 09:20+00', 'en'),
  ('eeeeeeee-0000-4000-8000-000000000109', 'bbbbbbbb-0000-4000-8000-000000000001', 'question', 'checkout', 'Can we check out at noon?', 'guest.three@example.test', 'handled', false, '2026-10-12 08:00+00', '2026-10-11 19:40+00', 'en')
on conflict (id) do nothing;

insert into app.reservations (id, property_id, source, external_id, stay_start, stay_end, guest_first_name, locale, party_size)
values
  ('ffffffff-0000-4000-8000-000000000104', 'bbbbbbbb-0000-4000-8000-000000000001', 'airbnb', 'HMTEST0004', '2026-10-05', '2026-10-09', 'Anna', 'en', 2),
  ('ffffffff-0000-4000-8000-000000000105', 'bbbbbbbb-0000-4000-8000-000000000001', 'direct', 'DIRECT-TEST-0005', '2026-10-19', '2026-10-23', 'Katja', 'sl', 4),
  ('ffffffff-0000-4000-8000-000000000106', 'bbbbbbbb-0000-4000-8000-000000000001', 'booking', 'BK-TEST-0006', '2026-12-22', '2026-12-29', 'Jonas', 'de', 5)
on conflict (id) do nothing;

commit;
