-- Approve French and Spanish as guest languages; keep in step with guestLocales in guide-validation.ts.
set role app_migrator;

alter table app.properties drop constraint properties_locales_check;
alter table app.properties add constraint properties_locales_check check (
  source_locale in ('en', 'de', 'sl', 'fr', 'es')
  and enabled_locales <@ array['en', 'de', 'sl', 'fr', 'es']::text[]
  and cardinality(enabled_locales) <= 3
);

alter table app.guide_translations drop constraint guide_translations_source_check;
alter table app.guide_translations add constraint guide_translations_source_check check (
  locale in ('en', 'de', 'sl', 'fr', 'es') and source_locale in ('en', 'de', 'sl', 'fr', 'es')
);

alter table app.guest_messages drop constraint guest_messages_locale_check;
alter table app.guest_messages add constraint guest_messages_locale_check check (locale in ('en', 'de', 'sl', 'fr', 'es'));

reset role;
