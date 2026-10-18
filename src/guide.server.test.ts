import { describe, expect, it } from 'vitest';
import { toGuestGuideDto, type GuestGuideRow } from './guide.server';

const property = { display_name: 'Synthetic villa', source_locale: 'en', enabled_locales: [] as string[] };

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
      sections: [
        { category: 'wifi', title: 'First', body: 'Synthetic body', fallback: false },
        { category: 'wifi', title: 'Second', body: 'Synthetic body', fallback: false },
      ],
    });
    for (const section of dto.sections) {
      expect(Object.keys(section)).toEqual(['category', 'title', 'body', 'fallback']);
    }
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
      { category: 'wifi', title: 'Übersetzt', body: 'Übersetzter Text', fallback: false },
      { category: 'wifi', title: 'Missing', body: 'Synthetic body', fallback: true },
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
      { category: 'wifi', title: 'Synthetic title', body: 'Synthetic body', fallback: false },
    ]);
  });

  it('always offers the source language plus enabled targets, sorted', () => {
    const dto = toGuestGuideDto({ ...property, enabled_locales: ['sl', 'de'] }, [], 'en');
    expect(dto.locales).toEqual(['de', 'en', 'sl']);
  });
});
