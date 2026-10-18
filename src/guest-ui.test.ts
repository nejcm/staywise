import { describe, expect, it } from 'vitest';
import { guestLocales } from './guide-validation';
import { guestLink, guestLocaleName, guestUi, guestUiKeys, guestUiText, languageNames } from './guest-ui';

describe('guest UI resources', () => {
  it('covers exactly the approved languages with identical key sets', () => {
    expect(Object.keys(guestUi).sort()).toEqual([...guestLocales].sort());
    for (const locale of guestLocales) {
      expect(Object.keys(guestUi[locale]).sort()).toEqual([...guestUiKeys].sort());
      for (const key of guestUiKeys) expect(guestUi[locale][key].trim()).not.toBe('');
    }
  });

  it('names every approved language and degrades safely for anything else', () => {
    for (const locale of guestLocales) expect(languageNames[locale].trim()).not.toBe('');
    expect(guestLocaleName('fr')).toBe('fr');
    expect(guestUiText('fr', 'nav.home')).toBe('Home');
  });

  it('substitutes placeholders in the fallback notice', () => {
    expect(guestUiText('de', 'fallback.notice', { language: 'English' })).toBe(
      'Der Originaltext wird auf English angezeigt.',
    );
    expect(guestUiText('en', 'fallback.notice', { language: 'Deutsch' })).toBe('Showing the original text in Deutsch.');
    expect(guestUiText('sl', 'fallback.notice', { language: 'English' })).toBe(
      'Prikazano je izvirno besedilo v jeziku English.',
    );
  });

  it('keeps a non-source language on guest links and plain paths for the source', () => {
    expect(guestLink('/g/synthetic/guide', 'de', 'en')).toBe('/g/synthetic/guide?lang=de');
    expect(guestLink('/g/synthetic/guide', 'en', 'en')).toBe('/g/synthetic/guide');
    expect(guestLink('/g/synthetic', 'de', 'de')).toBe('/g/synthetic');
    expect(guestLink('/g/synthetic/help', 'sl', 'de')).toBe('/g/synthetic/help?lang=sl');
  });
});
