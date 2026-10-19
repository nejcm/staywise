import { describe, expect, it } from 'vitest';
import {
  approveTranslationInput,
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
  it('trims names, accepts an approved language, and defaults to no enabled targets', () => {
    const parsed = propertyFields.safeParse({ displayName: '  Synthetic villa  ', sourceLocale: 'de' });
    expect(parsed.success && parsed.data).toEqual({
      displayName: 'Synthetic villa',
      sourceLocale: 'de',
      enabledLocales: [],
    });
  });

  it('rejects empty names, oversized names, and locales without guest resources', () => {
    expect(propertyFields.safeParse({ displayName: '   ', sourceLocale: 'en' }).success).toBe(false);
    expect(propertyFields.safeParse({ displayName: 'x'.repeat(121), sourceLocale: 'en' }).success).toBe(false);
    expect(propertyFields.safeParse({ displayName: 'Villa', sourceLocale: 'english' }).success).toBe(false);
    expect(propertyFields.safeParse({ displayName: 'Villa', sourceLocale: 'pt-BR' }).success).toBe(false);
    expect(propertyFields.safeParse({ displayName: 'Villa', sourceLocale: 'EN' }).success).toBe(false);
  });

  it('normalizes enabled locales to a sorted unique subset of the approved languages', () => {
    const parsed = propertyFields.safeParse({
      displayName: 'Villa',
      sourceLocale: 'en',
      enabledLocales: ['sl', 'de', 'sl'],
    });
    expect(parsed.success && parsed.data.enabledLocales).toEqual(['de', 'sl']);
    expect(
      propertyFields.safeParse({ displayName: 'Villa', sourceLocale: 'en', enabledLocales: ['de', 'fr'] }).success,
    ).toBe(false);
    expect(
      propertyFields.safeParse({ displayName: 'Villa', sourceLocale: 'en', enabledLocales: ['de', 'sl', 'de', 'sl'] })
        .success,
    ).toBe(false);
  });
});

describe('approveTranslationInput', () => {
  const approval = {
    propertyId: crypto.randomUUID(),
    translationId: crypto.randomUUID(),
    sourceRevision: 1,
    title: 'WLAN',
    body: 'Text',
  };

  it('accepts translated prose and rejects empty, oversized, or control-laden text', () => {
    expect(approveTranslationInput.safeParse(approval).success).toBe(true);
    expect(approveTranslationInput.safeParse({ ...approval, title: '  ' }).success).toBe(false);
    expect(approveTranslationInput.safeParse({ ...approval, body: 'x'.repeat(16001) }).success).toBe(false);
    expect(approveTranslationInput.safeParse({ ...approval, body: 'ok\u0000bad' }).success).toBe(false);
    expect(approveTranslationInput.safeParse({ ...approval, translationId: 'not-a-uuid' }).success).toBe(false);
    expect(approveTranslationInput.safeParse({ ...approval, sourceRevision: undefined }).success).toBe(false);
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
