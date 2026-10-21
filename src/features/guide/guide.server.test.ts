import { describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import {
  deleteHero,
  readHeroPath,
  toGuestGuideDto,
  updateHeroAlt,
  reserveHeroUpload,
  upsertHero,
  type GuestGuideRow,
} from './guide.server';

const property = {
  display_name: 'Synthetic villa',
  source_locale: 'en',
  enabled_locales: [] as string[],
  theme: 'staywise',
};

function row(overrides: Partial<GuestGuideRow> & { secret_value?: string | null }): GuestGuideRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    category: 'wifi',
    title: 'Synthetic title',
    body: 'Synthetic body',
    visibility: 'guest',
    published: true,
    display_order: 0,
    ...overrides,
  } as GuestGuideRow;
}

describe('toGuestGuideDto', () => {
  it('keeps only published guest prose, in display order', () => {
    const dto = toGuestGuideDto(
      property,
      [
        row({ title: 'Second', display_order: 2 }),
        row({ title: 'Draft', published: false, display_order: 1 }),
        row({ title: 'Note', visibility: 'host', display_order: 1 }),
        row({ title: 'First', display_order: 1 }),
      ],
      'en',
    );
    expect(dto).toEqual({
      displayName: 'Synthetic villa',
      sourceLocale: 'en',
      locale: 'en',
      locales: ['en'],
      theme: 'staywise',
      hero: null,
      sections: [
        { category: 'wifi', title: 'First', body: 'Synthetic body', provenance: 'source' },
        { category: 'wifi', title: 'Second', body: 'Synthetic body', provenance: 'source' },
      ],
    });
    for (const section of dto.sections) {
      expect(Object.keys(section)).toEqual(['category', 'title', 'body', 'provenance']);
    }
  });

  it('carries the hero metadata', () => {
    const hero = { alt: 'Lake view', width: 1600, height: 1067, version: '1792576800000' };
    expect(toGuestGuideDto(property, [], 'en', hero).hero).toEqual(hero);
  });

  it('carries the property theme', () => {
    expect(toGuestGuideDto({ ...property, theme: 'alpine' }, [], 'en').theme).toBe('alpine');
  });

  it('drops secret values and host-only notes even when the rows carry them', () => {
    const hostile: GuestGuideRow[] = [
      row({ title: 'Private', visibility: 'host', secret_value: 'SYNTHETIC-ALARM-CODE' }),
      row({ title: 'Guest', secret_value: 'SYNTHETIC-ALARM-CODE' }),
    ];
    const dto = toGuestGuideDto(property, hostile, 'en');
    expect(JSON.stringify(dto)).not.toContain('SYNTHETIC-ALARM-CODE');
    expect(dto.sections).toHaveLength(1);
  });

  it('returns an empty section list when nothing is guest-visible', () => {
    const dto = toGuestGuideDto(property, [row({ published: false }), row({ visibility: 'host' })], 'en');
    expect(dto.sections).toEqual([]);
  });

  it('serves the stored translation for an enabled locale and flags missing ones as fallback', () => {
    const multilingual = { ...property, enabled_locales: ['de'] };
    const dto = toGuestGuideDto(
      multilingual,
      [
        row({ title: 'Translated', translated_title: 'Übersetzt', translated_body: 'Übersetzter Text' }),
        row({ title: 'Missing', translated_title: null, translated_body: null }),
      ],
      'de',
    );
    expect(dto.locale).toBe('de');
    expect(dto.locales).toEqual(['de', 'en']);
    expect(dto.sections).toEqual([
      { category: 'wifi', title: 'Übersetzt', body: 'Übersetzter Text', provenance: 'reviewed' },
      { category: 'wifi', title: 'Missing', body: 'Synthetic body', provenance: 'fallback' },
    ]);
  });

  it('marks provenance per section: source, reviewed, and fallback for missing or stale', () => {
    const multilingual = { ...property, enabled_locales: ['de'] };
    const rows = [
      row({ translated_title: 'Geprüft', translated_body: 'Geprüfter Text' }),
      row({ translated_title: null, translated_body: null }),
      // The query nulls translations bound to an older source revision, so stale arrives like missing.
      row({ translated_title: 'Veraltet', translated_body: null }),
    ];
    expect(toGuestGuideDto(multilingual, rows, 'de').sections.map((s) => s.provenance)).toEqual([
      'reviewed',
      'fallback',
      'fallback',
    ]);
    expect(toGuestGuideDto(multilingual, rows, 'en').sections.map((s) => s.provenance)).toEqual([
      'source',
      'source',
      'source',
    ]);
  });

  it('ignores translated columns when the requested locale is not available', () => {
    const dto = toGuestGuideDto(
      property,
      [row({ translated_title: 'Traduit', translated_body: 'Texte traduit' })],
      'fr',
    );
    expect(dto.locale).toBe('en');
    expect(dto.locales).toEqual(['en']);
    expect(dto.sections).toEqual([
      { category: 'wifi', title: 'Synthetic title', body: 'Synthetic body', provenance: 'source' },
    ]);
  });

  it('always offers the source language plus enabled targets, sorted', () => {
    const dto = toGuestGuideDto({ ...property, enabled_locales: ['sl', 'de'] }, [], 'en');
    expect(dto.locales).toEqual(['de', 'en', 'sl']);
  });

  it('falls back to source when the requested language is not enabled', () => {
    expect(toGuestGuideDto({ ...property, enabled_locales: ['de'] }, [], 'sl').locale).toBe('en');
  });
});

// Answers each query in order and records its text and parameters.
function fakeTx(...results: unknown[][]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join('?'), values });
    return Promise.resolve(results.shift() ?? []);
  };
  return { tx: tx as unknown as postgres.TransactionSql, queries };
}

describe('hero writes', () => {
  const propertyId = '11111111-1111-4111-8111-111111111111';
  const created = new Date('2026-10-21T10:00:00.000Z');
  const input = { propertyId, alt: '  Lake view  ', width: 1600, height: 1067, bytes: 900000 };

  const objectPath = `${propertyId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;

  it('reserves a fresh key under the property prefix', async () => {
    const first = fakeTx([{ reserved: true }]);
    const path = await reserveHeroUpload(first.tx, propertyId);
    expect(path).toMatch(new RegExp(`^${propertyId}/[0-9a-f-]{36}\\.jpg$`));
    expect(first.queries[0]?.values).toEqual([propertyId, path]);
    expect(await reserveHeroUpload(fakeTx([{ reserved: true }]).tx, propertyId)).not.toBe(path);
    expect(await reserveHeroUpload(fakeTx([{ reserved: false }]).tx, propertyId)).toBeNull();
    await expect(reserveHeroUpload(fakeTx().tx, '../other')).rejects.toThrow('invalid_input');
  });

  it('claims the reservation, then stores the row and returns no path to guests', async () => {
    const stored = { alt: 'Lake view', width: 1600, height: 1067, created_at: created };
    const { tx, queries } = fakeTx([{}], [{ object_path: objectPath }], [stored]);
    expect(await upsertHero(tx, objectPath, input)).toEqual({
      alt: 'Lake view',
      width: 1600,
      height: 1067,
      version: String(created.getTime()),
    });
    expect(queries[1]?.text).toContain('not_before > clock_timestamp()');
    expect(queries[2]?.values).toEqual([propertyId, objectPath, 'Lake view', 1600, 1067, 900000]);
  });

  it('refuses a due or drained reservation, or a key outside the property prefix', async () => {
    const expired = fakeTx([{}], []);
    await expect(upsertHero(expired.tx, objectPath, input)).rejects.toThrow('upload_reservation_expired');
    expect(expired.queries).toHaveLength(2);
    const { tx, queries } = fakeTx([{}]);
    await expect(upsertHero(tx, 'other/x.jpg', input)).rejects.toThrow('invalid_input');
    expect(queries).toHaveLength(0);
  });

  it('writes nothing for a property the owner context cannot see', async () => {
    const { tx, queries } = fakeTx([]);
    expect(await upsertHero(tx, `${propertyId}/a.jpg`, input)).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it('rejects invalid input before any query', async () => {
    for (const bad of [
      { ...input, alt: '   ' },
      { ...input, alt: 'x'.repeat(201) },
      { ...input, alt: 'a\u0000b' },
      { ...input, bytes: 1048577 },
      { ...input, width: 0 },
      { ...input, propertyId: '../other' },
    ]) {
      const { tx, queries } = fakeTx();
      await expect(upsertHero(tx, `${propertyId}/a.jpg`, bad)).rejects.toThrow('invalid_input');
      expect(queries).toHaveLength(0);
    }
    await expect(updateHeroAlt(fakeTx().tx, propertyId, '')).rejects.toThrow('invalid_input');
  });

  it('reports whether an alt edit, removal, or path read found the row', async () => {
    expect(await updateHeroAlt(fakeTx([{ property_id: propertyId }]).tx, propertyId, 'Dusk')).toBe(true);
    expect(await deleteHero(fakeTx([]).tx, propertyId)).toBe(false);
    expect(await readHeroPath(fakeTx([{ object_path: `${propertyId}/a.jpg` }]).tx, propertyId)).toBe(
      `${propertyId}/a.jpg`,
    );
    expect(await readHeroPath(fakeTx([]).tx, propertyId)).toBeNull();
  });
});
