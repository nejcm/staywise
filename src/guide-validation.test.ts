import { describe, expect, it } from 'vitest';
import {
  collectFieldErrors,
  createSectionInput,
  propertyFields,
  saveSectionInput,
  sectionFields,
} from './guide-validation';

const validSection = {
  category: 'wifi',
  title: 'Wi-Fi',
  body: 'Synthetic network details',
  visibility: 'guest',
  secretValue: '',
  published: true,
};

describe('propertyFields', () => {
  it('trims names and accepts a language tag', () => {
    const parsed = propertyFields.safeParse({ displayName: '  Synthetic villa  ', sourceLocale: 'pt-BR' });
    expect(parsed.success && parsed.data).toEqual({ displayName: 'Synthetic villa', sourceLocale: 'pt-BR' });
  });

  it('rejects empty names, oversized names, and non-tag locales', () => {
    expect(propertyFields.safeParse({ displayName: '   ', sourceLocale: 'en' }).success).toBe(false);
    expect(propertyFields.safeParse({ displayName: 'x'.repeat(121), sourceLocale: 'en' }).success).toBe(false);
    expect(propertyFields.safeParse({ displayName: 'Villa', sourceLocale: 'english' }).success).toBe(false);
    expect(propertyFields.safeParse({ displayName: 'Villa', sourceLocale: 'EN' }).success).toBe(false);
  });
});

describe('sectionFields', () => {
  it('accepts guest prose without a secret and defaults the secret to empty', () => {
    const parsed = sectionFields.safeParse({ ...validSection, secretValue: undefined });
    expect(parsed.success && parsed.data.secretValue).toBe('');
  });

  it('rejects a secret value on a guest section', () => {
    const parsed = sectionFields.safeParse({ ...validSection, secretValue: 'SYNTHETIC-CODE' });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(collectFieldErrors(parsed.error)).toEqual({ secretValue: 'A secret value belongs to a private note' });
  });

  it('accepts a secret value on a private note', () => {
    const parsed = sectionFields.safeParse({ ...validSection, visibility: 'host', secretValue: 'SYNTHETIC-CODE' });
    expect(parsed.success).toBe(true);
  });

  it('rejects empty titles, oversized text, and oversized secrets', () => {
    expect(sectionFields.safeParse({ ...validSection, title: '  ' }).success).toBe(false);
    expect(sectionFields.safeParse({ ...validSection, body: 'x'.repeat(8001) }).success).toBe(false);
    expect(sectionFields.safeParse({ ...validSection, visibility: 'host', secretValue: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });
});

describe('section ids and categories', () => {
  it('rejects unknown categories and non-uuid identifiers', () => {
    expect(createSectionInput.safeParse({ propertyId: crypto.randomUUID(), category: 'unicorns' }).success).toBe(false);
    expect(
      saveSectionInput.safeParse({ ...validSection, propertyId: 'not-a-uuid', sectionId: 'also-not' }).success,
    ).toBe(false);
  });
});
