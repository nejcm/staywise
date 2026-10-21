-- Phase 5 translation constraints, source binding, audit vocabulary, and the link-scoped guest read
-- policy for stored translations.
begin;

create extension if not exists pgtap;

select plan(28);

do $$ begin execute format('grant app_runtime to %I with set true', current_user); end $$;

-- Fixtures; the runner inserts bypass forced RLS and the whole file rolls back.
insert into auth.users (id, email) values
  ('7b000000-0000-4000-8000-0000000000a1', 'pgtap-loc-a@example.test'),
  ('7b000000-0000-4000-8000-0000000000b1', 'pgtap-loc-b@example.test'),
  ('7b000000-0000-4000-8000-0000000000d1', 'pgtap-loc-d@example.test');
insert into app.properties (id, owner_id, display_name, published, source_locale, enabled_locales) values
  ('7b000000-0000-4000-8000-0000000000a2', '7b000000-0000-4000-8000-0000000000a1', 'Localized A', true, 'en', array['de', 'sl']),
  ('7b000000-0000-4000-8000-0000000000a6', '7b000000-0000-4000-8000-0000000000a1', 'No targets', true, 'en', '{}'),
  ('7b000000-0000-4000-8000-0000000000a8', '7b000000-0000-4000-8000-0000000000a1', 'Offline', false, 'en', array['de']),
  ('7b000000-0000-4000-8000-0000000000b2', '7b000000-0000-4000-8000-0000000000b1', 'Localized B', true, 'en', array['de']);
insert into app.guide_sections (id, property_id, category, title, body, visibility, published, source_revision) values
  ('7b000000-0000-4000-8000-0000000000a3', '7b000000-0000-4000-8000-0000000000a2', 'wifi', 'Guest Wi-Fi', 'Synthetic guest body', 'guest', true, 1),
  ('7b000000-0000-4000-8000-0000000000a4', '7b000000-0000-4000-8000-0000000000a2', 'wifi', 'Private note', 'Synthetic private note', 'host', false, 1),
  ('7b000000-0000-4000-8000-0000000000a5', '7b000000-0000-4000-8000-0000000000a2', 'wifi', 'Draft', 'Synthetic draft body', 'guest', false, 1),
  ('7b000000-0000-4000-8000-0000000000a9', '7b000000-0000-4000-8000-0000000000a2', 'wifi', 'Edited since', 'Synthetic edited body', 'guest', true, 5),
  ('7b000000-0000-4000-8000-0000000000ab', '7b000000-0000-4000-8000-0000000000a6', 'wifi', 'No enabled target', 'Synthetic body', 'guest', true, 1),
  ('7b000000-0000-4000-8000-0000000000b3', '7b000000-0000-4000-8000-0000000000b2', 'wifi', 'Other host', 'Synthetic other body', 'guest', true, 1);
insert into app.guide_translations (id, section_id, locale, title, body, source_revision, source_locale, state, provider) values
  ('7b000000-0000-4000-8000-0000000000c1', '7b000000-0000-4000-8000-0000000000a3', 'de', 'Gast-WLAN', 'Synthetischer Text', 1, 'en', 'approved', 'pgtap'),
  ('7b000000-0000-4000-8000-0000000000c2', '7b000000-0000-4000-8000-0000000000a3', 'sl', 'Gost Wi-Fi', 'Sintetično besedilo', 1, 'en', 'draft', 'pgtap'),
  ('7b000000-0000-4000-8000-0000000000c3', '7b000000-0000-4000-8000-0000000000a4', 'de', 'Notiz', 'Synthetische Notiz', 1, 'en', 'approved', 'pgtap'),
  ('7b000000-0000-4000-8000-0000000000c4', '7b000000-0000-4000-8000-0000000000a5', 'de', 'Entwurf', 'Synthetischer Entwurf', 1, 'en', 'approved', 'pgtap'),
  ('7b000000-0000-4000-8000-0000000000c5', '7b000000-0000-4000-8000-0000000000a9', 'de', 'Veraltet', 'Synthetisch veraltet', 4, 'en', 'approved', 'pgtap'),
  ('7b000000-0000-4000-8000-0000000000c6', '7b000000-0000-4000-8000-0000000000a9', 'sl', 'Napačen vir', 'Sintetično', 5, 'de', 'approved', 'pgtap'),
  ('7b000000-0000-4000-8000-0000000000c7', '7b000000-0000-4000-8000-0000000000ab', 'de', 'Nicht aktiviert', 'Synthetisch', 1, 'en', 'approved', 'pgtap'),
  ('7b000000-0000-4000-8000-0000000000c8', '7b000000-0000-4000-8000-0000000000b3', 'de', 'Fremd', 'Synthetisch fremd', 1, 'en', 'approved', 'pgtap');
insert into app.share_links (id, secret_hmac, property_id) values
  ('pgtapLinkP500000001', '\x0102', '7b000000-0000-4000-8000-0000000000a2'),
  ('pgtapLinkP500000002', '\x0102', '7b000000-0000-4000-8000-0000000000b2'),
  ('pgtapLinkP500000003', '\x0102', '7b000000-0000-4000-8000-0000000000a6'),
  ('pgtapLinkP500000004', '\x0102', '7b000000-0000-4000-8000-0000000000a8');

-- Translation lifecycle actions join the audit vocabulary; unknown names stay rejected.
create temp table probe_audit_translation on commit drop as
  with ins as (
    insert into app.audit_events (actor_id, action)
      values
        ('7b000000-0000-4000-8000-0000000000a1', 'translation_generated'),
        ('7b000000-0000-4000-8000-0000000000a1', 'translation_approved'),
        ('7b000000-0000-4000-8000-0000000000a1', 'translation_rejected')
      returning 1 as n
  )
  select count(*)::bigint as n from ins;
create temp table probe_audit_bogus_translation (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.audit_events (actor_id, action) values ('7b000000-0000-4000-8000-0000000000a1', 'translation_deleted');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_audit_bogus_translation (blocked, err_state) values (blocked, err_state);
end $$;

-- Locale vocabulary and source binding are enforced in the schema.
create temp table probe_locale_source (blocked boolean not null, err_state text) on commit drop;
create temp table probe_locale_enabled (blocked boolean not null, err_state text) on commit drop;
create temp table probe_locale_translation (blocked boolean not null, err_state text) on commit drop;
create temp table probe_locale_source_locale (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.properties (owner_id, display_name, source_locale)
      values ('7b000000-0000-4000-8000-0000000000a1', 'Bad source', 'it');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_locale_source (blocked, err_state) values (blocked, err_state);
end $$;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.properties (owner_id, display_name, enabled_locales)
      values ('7b000000-0000-4000-8000-0000000000a1', 'Bad targets', array['de', 'it']);
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_locale_enabled (blocked, err_state) values (blocked, err_state);
end $$;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guide_translations (section_id, locale, title, body, source_revision, source_locale)
      values ('7b000000-0000-4000-8000-0000000000a3', 'it', 'T', 'B', 1, 'en');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_locale_translation (blocked, err_state) values (blocked, err_state);
end $$;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guide_translations (section_id, locale, title, body, source_revision, source_locale)
      values ('7b000000-0000-4000-8000-0000000000a3', 'sl', 'T', 'B', 1, 'it');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_locale_source_locale (blocked, err_state) values (blocked, err_state);
end $$;

-- Link context: only approved translations bound to the live revision, source language, enabled
-- locale, guest-visible published section, and published property come back.
set local role app_runtime;
select set_config('app.link_id', 'pgtapLinkP500000001', true);
select set_config('app.link_property_id', '7b000000-0000-4000-8000-0000000000a2', true);
create temp table probe_link_translations on commit drop as select count(*)::bigint as n from app.guide_translations;
create temp table probe_link_translation_title on commit drop as
  select title from app.guide_translations where section_id = '7b000000-0000-4000-8000-0000000000a3' and locale = 'de';
create temp table probe_link_draft on commit drop as
  select count(*)::bigint as n from app.guide_translations where state = 'draft';
create temp table probe_link_private on commit drop as
  select count(*)::bigint as n from app.guide_translations where section_id = '7b000000-0000-4000-8000-0000000000a4';
create temp table probe_link_unpublished on commit drop as
  select count(*)::bigint as n from app.guide_translations where section_id = '7b000000-0000-4000-8000-0000000000a5';
create temp table probe_link_stale on commit drop as
  select count(*)::bigint as n from app.guide_translations where id = '7b000000-0000-4000-8000-0000000000c5';
create temp table probe_link_source_switch on commit drop as
  select count(*)::bigint as n from app.guide_translations where id = '7b000000-0000-4000-8000-0000000000c6';
create temp table probe_link_foreign on commit drop as
  select count(*)::bigint as n from app.guide_translations where section_id = '7b000000-0000-4000-8000-0000000000b3';
create temp table probe_link_insert (blocked boolean not null, err_state text) on commit drop;
do $$
declare
  blocked boolean := false;
  err_state text := 'none';
begin
  begin
    insert into app.guide_translations (section_id, locale, title, body, source_revision, source_locale)
      values ('7b000000-0000-4000-8000-0000000000a3', 'de', 'Hijack', 'Hijack', 1, 'en');
  exception when others then
    blocked := true;
    get stacked diagnostics err_state = returned_sqlstate;
  end;
  insert into probe_link_insert (blocked, err_state) values (blocked, err_state);
end $$;
reset role;
select set_config('app.link_id', '', true);
select set_config('app.link_property_id', '', true);

set local role app_runtime;
select set_config('app.link_id', 'pgtapLinkP500000003', true);
select set_config('app.link_property_id', '7b000000-0000-4000-8000-0000000000a6', true);
create temp table probe_link_no_targets on commit drop as select count(*)::bigint as n from app.guide_translations;
reset role;
select set_config('app.link_id', '', true);
select set_config('app.link_property_id', '', true);

set local role app_runtime;
select set_config('app.link_id', 'pgtapLinkP500000004', true);
select set_config('app.link_property_id', '7b000000-0000-4000-8000-0000000000a8', true);
create temp table probe_link_unpublished_property on commit drop as select count(*)::bigint as n from app.guide_translations;
reset role;
select set_config('app.link_id', '', true);
select set_config('app.link_property_id', '', true);

set local role app_runtime;
create temp table probe_link_no_context on commit drop as select count(*)::bigint as n from app.guide_translations;
reset role;

-- Owner context: own rows including drafts and stale ones, never another host's.
set local role app_runtime;
select set_config('app.owner_id', '7b000000-0000-4000-8000-0000000000a1', true);
create temp table probe_owner_translations on commit drop as select count(*)::bigint as n from app.guide_translations;
create temp table probe_owner_foreign on commit drop as
  select count(*)::bigint as n from app.guide_translations where section_id = '7b000000-0000-4000-8000-0000000000b3';
create temp table probe_owner_cross_approve on commit drop as
  with updated as (
    update app.guide_translations set state = 'approved'
    where id = '7b000000-0000-4000-8000-0000000000c8' returning 1
  )
  select count(*)::bigint as n from updated;
create temp table probe_owner_approve on commit drop as
  with updated as (
    update app.guide_translations set state = 'approved', reviewed_at = now()
    where id = '7b000000-0000-4000-8000-0000000000c2' returning 1
  )
  select count(*)::bigint as n from updated;
reset role;
select set_config('app.owner_id', '', true);

-- Deleting a section cascades to its translations.
delete from app.guide_sections where id = '7b000000-0000-4000-8000-0000000000a3';
create temp table probe_cascade_translation on commit drop as
  select count(*)::bigint as n from app.guide_translations where section_id = '7b000000-0000-4000-8000-0000000000a3';

select is((select n from probe_audit_translation), 3::bigint, 'translation lifecycle actions are valid audit actions');
select is((select blocked from probe_audit_bogus_translation), true, 'unknown translation audit actions stay rejected');
select is((select blocked from probe_locale_source), true, 'a source locale without guest resources is rejected');
select is((select err_state from probe_locale_source), '23514', 'an unapproved source locale fails the check constraint');
select is((select blocked from probe_locale_enabled), true, 'an unapproved target locale is rejected');
select is((select err_state from probe_locale_enabled), '23514', 'an unapproved target locale fails the check constraint');
select is((select blocked from probe_locale_translation), true, 'a translation locale without guest resources is rejected');
select is((select blocked from probe_locale_source_locale), true, 'a translation source locale without guest resources is rejected');
select is((select n from probe_link_translations), 1::bigint, 'link context sees only the approved current translation');
select is((select title from probe_link_translation_title), 'Gast-WLAN', 'link context sees the approved translation itself');
select is((select n from probe_link_draft), 0::bigint, 'unreviewed drafts are invisible to guest reads');
select is((select n from probe_link_private), 0::bigint, 'translations of host-only notes are invisible to guest reads');
select is((select n from probe_link_unpublished), 0::bigint, 'translations of unpublished sections are invisible to guest reads');
select is((select n from probe_link_stale), 0::bigint, 'a translation left behind by a source edit is invisible to guest reads');
select is((select n from probe_link_source_switch), 0::bigint, 'a translation from a previous source language is invisible');
select is((select n from probe_link_foreign), 0::bigint, 'another property translation is invisible to guest reads');
select is((select blocked from probe_link_insert), true, 'guest link context cannot write translations');
select is((select err_state from probe_link_insert), '42501', 'foreign translation insert fails with an RLS violation');
select is((select n from probe_link_no_targets), 0::bigint, 'a disabled guest language serves no translations');
select is((select n from probe_link_unpublished_property), 0::bigint, 'an unpublished property serves no translations');
select is((select n from probe_link_no_context), 0::bigint, 'without link context no translations are visible');
select is((select n from probe_owner_translations), 7::bigint, 'owner context sees own rows including drafts and stale ones');
select is((select n from probe_owner_foreign), 0::bigint, 'owner context never sees another host translation');
select is((select n from probe_owner_cross_approve), 0::bigint, 'owner context cannot approve another host translation');
select is((select n from probe_owner_approve), 1::bigint, 'owner context approves its own draft');

-- Positive probes run last so the earlier row counts stay untouched.
select lives_ok(
  $$insert into app.properties (id, owner_id, display_name, source_locale, enabled_locales)
    values ('7b000000-0000-4000-8000-0000000000d2', '7b000000-0000-4000-8000-0000000000d1', 'French source', 'fr', array['es', 'en'])$$,
  'French source and Spanish target are approved locales'
);
select lives_ok(
  $$insert into app.guide_sections (id, property_id, category, title, body, visibility, published, source_revision)
    values ('7b000000-0000-4000-8000-0000000000d3', '7b000000-0000-4000-8000-0000000000d2', 'wifi', 'Wi-Fi', 'Corps synthétique', 'guest', true, 1)$$,
  'a section on a French-source property is accepted'
);
select lives_ok(
  $$insert into app.guide_translations (section_id, locale, title, body, source_revision, source_locale)
    values ('7b000000-0000-4000-8000-0000000000d3', 'es', 'Wi-Fi', 'Cuerpo sintético', 1, 'fr')$$,
  'a Spanish translation from a French source is accepted'
);

select * from finish();
rollback;
