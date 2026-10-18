-- Phase 5: stored guide localization — approved-locale vocabulary, translations bound to their
-- source revision and source language, and a link-scoped guest read for approved current rows.
set role app_migrator;

alter table app.audit_events drop constraint audit_events_action_check;
alter table app.audit_events add constraint audit_events_action_check
  check (
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
      'translation_rejected'
    )
  );

-- Only approved pilot languages can be selected; at most three target locales per property, and
-- the source locale is always available to guests.
alter table app.properties add column enabled_locales text[] not null default '{}';
alter table app.guide_translations add column source_locale text not null default 'en';

-- Existing rows predate this vocabulary: the earlier schema accepted any language tag such as
-- en-US or fr-FR. Supported regional tags are normalized below to their base language (en-US
-- becomes en, de-AT becomes de, sl-SI becomes sl). A tag whose base language is not approved cannot
-- be mapped without guessing, so this preflight stops the whole migration before any schema change,
-- names every row an operator must resolve by hand, and commits nothing. The migration never
-- rewrites prose, deletes rows, or guesses a language: a source tag may be corrected directly only
-- when it was wrong metadata for approved-language prose, while genuine unsupported-language prose
-- needs an owner-reviewed source translation and translation invalidation first. The full recovery
-- procedure, including export and manual row handling, is documented in
-- plans/implementation_plan.md section 7 "Phase 5 upgrade recovery".
-- These three tables force row level security even for their owner, so the migration drops the
-- enforcement for the inspection and normalization below as app_migrator; it is all one
-- transaction, a failed run changes nothing, and the flags are restored afterwards.
alter table app.properties disable row level security;
alter table app.guide_sections disable row level security;
alter table app.guide_translations disable row level security;

do $$
declare
  offenders text;
begin
  select string_agg(format('property %s (source_locale %s)', id, source_locale), '; ')
    into offenders
  from app.properties
  where lower(split_part(replace(source_locale, '_', '-'), '-', 1)) not in ('en', 'de', 'sl');
  if offenders is not null then
    raise exception 'phase5 preflight: property source_locale outside en/de/sl: %; recovery: plans/implementation_plan.md section 7 "Phase 5 upgrade recovery" (a tag change alone does not translate prose)', offenders;
  end if;

  select string_agg(format('translation %s (locale %s)', id, locale), '; ')
    into offenders
  from app.guide_translations
  where lower(split_part(replace(locale, '_', '-'), '-', 1)) not in ('en', 'de', 'sl');
  if offenders is not null then
    raise exception 'phase5 preflight: guide_translations.locale outside en/de/sl: %; recovery: plans/implementation_plan.md section 7 "Phase 5 upgrade recovery"', offenders;
  end if;

  select string_agg(format('section %s (locale %s)', section_id, locale), '; ')
    into offenders
  from (
    select t.section_id, lower(split_part(replace(t.locale, '_', '-'), '-', 1)) as locale
    from app.guide_translations t
    group by 1, 2
    having count(*) > 1
  ) collapsing;
  if offenders is not null then
    raise exception 'phase5 preflight: regional tags collapse onto one stored locale: %; recovery: plans/implementation_plan.md section 7 "Phase 5 upgrade recovery"', offenders;
  end if;
end $$;

-- Lossless normalization of the supported regional tags; guide prose and ownership are untouched.
update app.properties
set source_locale = lower(split_part(replace(source_locale, '_', '-'), '-', 1))
where source_locale not in ('en', 'de', 'sl');

update app.guide_translations
set locale = lower(split_part(replace(locale, '_', '-'), '-', 1))
where locale not in ('en', 'de', 'sl');

-- A stored translation binds to the source revision and the source language it was generated
-- from, so both a source edit and a source-language switch invalidate it. Existing rows bind to
-- their property's real source language; a revision mismatch stays stale exactly as before.
update app.guide_translations t
set source_locale = p.source_locale
from app.guide_sections s
join app.properties p on p.id = s.property_id
where t.section_id = s.id;

alter table app.properties enable row level security;
alter table app.properties force row level security;
alter table app.guide_sections enable row level security;
alter table app.guide_sections force row level security;
alter table app.guide_translations enable row level security;
alter table app.guide_translations force row level security;

alter table app.properties add constraint properties_locales_check check (
  source_locale in ('en', 'de', 'sl')
  and enabled_locales <@ array['en', 'de', 'sl']::text[]
  and cardinality(enabled_locales) <= 3
);
alter table app.guide_translations add constraint guide_translations_source_check check (
  locale in ('en', 'de', 'sl') and source_locale in ('en', 'de', 'sl')
);

-- Guests read only approved translations whose binding still matches the live section and
-- property: unreviewed, stale, host-only, unpublished, disabled-locale, and cross-property rows
-- stay invisible even when a caller asks for them.
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

reset role;
