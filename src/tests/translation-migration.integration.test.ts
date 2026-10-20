// Upgrade regression for the Phase 5 migration on a scratch database populated through the
// pre-Phase-5 schema: supported regional tags normalize without losing prose or ownership, existing
// translations bind to the property's real source with safe currentness, and unsupported or
// colliding locales stop the migration with a named preflight instead of dropping or relabelling
// data. A populated unsupported-source property then follows the documented recovery — reviewed
// source translation, invalidated translation — before its tag is corrected. Synthetic data only;
// the scratch database is dropped at the end.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectLocalDb, localAdmin, migrationFiles } from './integration-helpers';

const dbUp = await detectLocalDb();
const describeLocal = dbUp ? describe : describe.skip;

const PHASE5 = migrationFiles.find((path) => path.endsWith('20261019130000_phase5_translations.sql'))!;

describeLocal('phase 5 migration upgrade (scratch database)', () => {
  it('normalizes supported regional tags, rejects unsupported and colliding locales, and preserves data through the documented recovery', async () => {
    const dbName = `scratch_phase5_upgrade_${Date.now()}`;
    const admin = localAdmin();
    let created = false;
    try {
      await admin.unsafe(`create database ${dbName}`);
      created = true;
      const scratch = localAdmin(dbName);
      try {
        await scratch.unsafe('create schema auth; create table auth.users (id uuid primary key);');
        for (const migration of migrationFiles.filter((path) => path < PHASE5)) {
          await scratch.unsafe(readFileSync(migration, 'utf8'));
        }

        const ownerId = randomUUID();
        await scratch`insert into auth.users (id) values (${ownerId})`;
        const [regional] = await scratch<{ id: string }[]>`
          insert into app.properties (owner_id, display_name, source_locale)
          values (${ownerId}, 'Synthetic regional source', 'en-US') returning id
        `;
        const [unsupported] = await scratch<{ id: string }[]>`
          insert into app.properties (owner_id, display_name, source_locale)
          values (${ownerId}, 'Synthetic unsupported source', 'fr-FR') returning id
        `;
        const [foreignSection] = await scratch<{ id: string }[]>`
          insert into app.guide_sections (property_id, category, title, body, published)
          values (${unsupported!.id}, 'arrival', 'Arrivée', 'Bonjour, bienvenue dans votre logement.', true)
          returning id
        `;
        const [section] = await scratch<{ id: string }[]>`
          insert into app.guide_sections (property_id, category, title, body, published)
          values (${regional!.id}, 'arrival', 'Synthetic arrival', 'Synthetic arrival prose', true)
          returning id
        `;
        for (const row of [
          {
            locale: 'de-DE',
            title: 'Synthetische Ankunft',
            body: 'Synthetischer Text',
            revision: 1,
            state: 'approved',
          },
          { locale: 'sl-SI', title: 'Sintetični prihod', body: 'Sintetično besedilo', revision: 0, state: 'draft' },
          { locale: 'sl', title: 'Podvojen prihod', body: 'Podvojeno besedilo', revision: 1, state: 'approved' },
          { locale: 'fr-FR', title: 'Arrivée synthétique', body: 'Texte synthétique', revision: 1, state: 'draft' },
        ]) {
          await scratch`insert into app.guide_translations (section_id, locale, title, body, source_revision, state)
            values (${section!.id}, ${row.locale}, ${row.title}, ${row.body}, ${row.revision}, ${row.state})`;
        }

        await scratch`insert into app.guide_translations (section_id, locale, title, body, source_revision, state)
          values (${foreignSection!.id}, 'de', 'Ankunft', 'Willkommen in Ihrer Unterkunft.', 1, 'approved')`;

        const applyPhase5 = () => scratch.unsafe(readFileSync(PHASE5, 'utf8'));

        // 1. Unsupported property source locale: the migration stops before any schema change.
        await expect(applyPhase5()).rejects.toThrow(
          /phase5 preflight: property source_locale outside en\/de\/sl.*fr-FR/,
        );
        expect(
          await scratch<{ display_name: string; source_locale: string }[]>`
            select display_name, source_locale from app.properties order by display_name`,
        ).toEqual([
          { display_name: 'Synthetic regional source', source_locale: 'en-US' },
          { display_name: 'Synthetic unsupported source', source_locale: 'fr-FR' },
        ]);
        expect(await scratch`select id from app.guide_translations`).toHaveLength(5);
        expect(
          await scratch<{ title: string; body: string }[]>`
            select title, body from app.guide_sections where id = ${foreignSection!.id}`,
        ).toEqual([{ title: 'Arrivée', body: 'Bonjour, bienvenue dans votre logement.' }]);

        // Documented safe recovery for genuine unsupported-language prose
        // (plans/implementation_plan.md section 7): the owner translates/reviews the actual source,
        // invalidating the translations made from the old source, and only then corrects the tag.
        // The reviewed edit is represented here by replacing the French prose with reviewed English
        // text and bumping the source revision, which is what a source edit through the editor does.
        await scratch`update app.guide_sections
          set title = 'Welcome', body = 'Welcome to your home.', source_revision = source_revision + 1
          where id = ${foreignSection!.id}`;
        await scratch`update app.properties set source_locale = 'en' where id = ${unsupported!.id}`;

        // 2. Unsupported stored translation locale.
        await expect(applyPhase5()).rejects.toThrow(
          /phase5 preflight: guide_translations.locale outside en\/de\/sl.*fr-FR/,
        );

        // Recovery: the unapproved translation row is removed by hand.
        await scratch`delete from app.guide_translations where section_id = ${section!.id} and locale = 'fr-FR'`;

        // 3. A regional tag that would collapse onto an already stored locale.
        await expect(applyPhase5()).rejects.toThrow(/phase5 preflight: regional tags collapse onto one stored locale/);

        // Recovery: keep one row per locale (the regional one wins here).
        await scratch`delete from app.guide_translations where section_id = ${section!.id} and locale = 'sl'`;

        // 4. The migration now applies.
        await applyPhase5();

        expect(
          await scratch<{ display_name: string; source_locale: string; owner_id: string; enabled_locales: string[] }[]>`
            select display_name, source_locale, owner_id, enabled_locales from app.properties order by display_name`,
        ).toEqual([
          {
            display_name: 'Synthetic regional source',
            source_locale: 'en',
            owner_id: ownerId,
            enabled_locales: [],
          },
          {
            display_name: 'Synthetic unsupported source',
            source_locale: 'en',
            owner_id: ownerId,
            enabled_locales: [],
          },
        ]);
        expect(
          await scratch<{ title: string; body: string; source_revision: number }[]>`
            select title, body, source_revision from app.guide_sections where id = ${section!.id}`,
        ).toEqual([{ title: 'Synthetic arrival', body: 'Synthetic arrival prose', source_revision: 1 }]);
        expect(
          await scratch<
            { locale: string; source_locale: string; source_revision: number; state: string; title: string }[]
          >`
            select locale, source_locale, source_revision, state, title from app.guide_translations
            where section_id = ${section!.id} order by locale`,
        ).toEqual([
          { locale: 'de', source_locale: 'en', source_revision: 1, state: 'approved', title: 'Synthetische Ankunft' },
          { locale: 'sl', source_locale: 'en', source_revision: 0, state: 'draft', title: 'Sintetični prihod' },
        ]);
        // The recovered source keeps its pre-recovery translation, rebound to the real source
        // language but stale against the reviewed source revision.
        expect(
          await scratch<{ title: string; body: string; source_revision: number }[]>`
            select title, body, source_revision from app.guide_sections where id = ${foreignSection!.id}`,
        ).toEqual([{ title: 'Welcome', body: 'Welcome to your home.', source_revision: 2 }]);
        expect(
          await scratch<{ source_locale: string; source_revision: number; state: string; title: string }[]>`
            select source_locale, source_revision, state, title from app.guide_translations
            where section_id = ${foreignSection!.id}`,
        ).toEqual([{ source_locale: 'en', source_revision: 1, state: 'approved', title: 'Ankunft' }]);
        expect(
          await scratch<{ display_name: string; locale: string; current: boolean }[]>`
            select p.display_name, t.locale,
              (t.source_revision = s.source_revision and t.source_locale = p.source_locale) as current
            from app.guide_translations t
            join app.guide_sections s on s.id = t.section_id
            join app.properties p on p.id = s.property_id
            order by p.display_name, t.locale`,
        ).toEqual([
          { display_name: 'Synthetic regional source', locale: 'de', current: true },
          { display_name: 'Synthetic regional source', locale: 'sl', current: false },
          { display_name: 'Synthetic unsupported source', locale: 'de', current: false },
        ]);
        expect(
          await scratch<{ conname: string }[]>`
            select conname from pg_constraint
            where conrelid in ('app.properties'::regclass, 'app.guide_translations'::regclass)
              and conname in ('properties_locales_check', 'guide_translations_source_check')
            order by conname`,
        ).toEqual([{ conname: 'guide_translations_source_check' }, { conname: 'properties_locales_check' }]);
      } finally {
        await scratch.end({ timeout: 0 });
      }
    } finally {
      if (created) await admin.unsafe(`drop database ${dbName} with (force)`);
      await admin.end({ timeout: 0 });
    }
  }, 60_000);
});
