import { describe, expect, it } from 'vitest';
import { toGuestGuideDto, type GuestGuideRow } from './guide.server';

const property = { display_name: 'Synthetic villa', source_locale: 'en' };

function row(overrides: Partial<GuestGuideRow> & { secret_value?: string | null }): GuestGuideRow {
  return {
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
    const dto = toGuestGuideDto(property, [
      row({ title: 'Second', display_order: 2 }),
      row({ title: 'Draft', published: false, display_order: 1 }),
      row({ title: 'Note', visibility: 'host', display_order: 1 }),
      row({ title: 'First', display_order: 1 }),
    ]);
    expect(dto).toEqual({
      displayName: 'Synthetic villa',
      sourceLocale: 'en',
      sections: [
        { category: 'wifi', title: 'First', body: 'Synthetic body' },
        { category: 'wifi', title: 'Second', body: 'Synthetic body' },
      ],
    });
    for (const section of dto.sections) {
      expect(Object.keys(section)).toEqual(['category', 'title', 'body']);
    }
  });

  it('drops secret values and host-only notes even when the rows carry them', () => {
    const hostile: GuestGuideRow[] = [
      row({ title: 'Private', visibility: 'host', secret_value: 'SYNTHETIC-ALARM-CODE' }),
      row({ title: 'Guest', secret_value: 'SYNTHETIC-ALARM-CODE' }),
    ];
    const dto = toGuestGuideDto(property, hostile);
    expect(JSON.stringify(dto)).not.toContain('SYNTHETIC-ALARM-CODE');
    expect(dto.sections).toHaveLength(1);
  });

  it('returns an empty section list when nothing is guest-visible', () => {
    const dto = toGuestGuideDto(property, [row({ published: false }), row({ visibility: 'host' })]);
    expect(dto.sections).toEqual([]);
  });
});
