import { describe, expect, it } from 'vitest';
import type { GuideEditorData } from './guide.server';
import { readiness } from './readiness';

const empty: GuideEditorData = {
  hero: null,
  property: {
    id: 'p1',
    displayName: 'Synthetic villa',
    sourceLocale: 'en',
    enabledLocales: ['en'],
    published: false,
    alertEmail: null,
    theme: 'staywise',
    wifiName: null,
    wifiPassword: null,
    keyboxCode: null,
    checkinTime: null,
    checkoutTime: null,
    address: null,
    contactPhone: null,
    answerFrom: null,
    answerTo: null,
    timezone: 'UTC',
  },
  timeZones: ['UTC'],
  sections: [],
};

function section(id: string, category: string, published: boolean) {
  return {
    id,
    category,
    title: '',
    body: '',
    visibility: 'guest',
    secretValue: null,
    displayOrder: 1,
    sourceRevision: 1,
    published,
    translations: [],
  } as unknown as GuideEditorData['sections'][number];
}

describe('readiness', () => {
  it('lists every essential in order, all pending for an empty property', () => {
    const items = readiness(empty, false);
    expect(items.map((item) => item.key)).toEqual([
      'checkinTime',
      'checkoutTime',
      'address',
      'contactPhone',
      'wifiPassword',
      'arrival',
      'emergency',
      'published',
      'link',
    ]);
    expect(items.every((item) => !item.done)).toBe(true);
    expect(items.find((item) => item.key === 'arrival')).toMatchObject({ pane: 'new', anchor: 'section-new-heading' });
  });

  it('counts only published guest sections and points at an existing draft', () => {
    const items = readiness(
      {
        ...empty,
        property: { ...empty.property, checkinTime: '15:00', published: true },
        sections: [section('s-wifi', 'wifi', true), section('s-arrival', 'arrival', false)],
      },
      true,
    );
    const done = Object.fromEntries(items.map((item) => [item.key, item.done]));
    expect(done).toMatchObject({ checkinTime: true, wifiPassword: true, arrival: false, published: true, link: true });
    expect(items.find((item) => item.key === 'arrival')).toMatchObject({
      pane: 's-arrival',
      anchor: 'section-title-s-arrival',
    });
  });

  it('suggests a cover photo only when uploads are available, as an optional item', () => {
    expect(readiness(empty, false).some((item) => item.key === 'hero')).toBe(false);
    expect(readiness(empty, false, true).at(-1)).toMatchObject({ key: 'hero', done: false, optional: true });
    const hero = { alt: 'Lake', width: 1600, height: 1067, version: '1' };
    expect(readiness({ ...empty, hero }, false, true).at(-1)?.done).toBe(true);
  });
});
