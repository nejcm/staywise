import { describe, expect, it } from 'vitest';
import { guestLocales } from '../guide/guide-validation';
import {
  answerHoursText,
  avatarInitial,
  guestLink,
  guestLocaleName,
  guestUi,
  guestUiKeys,
  guestUiText,
  languageNames,
  mapSearchUrl,
} from './guest-ui';

describe('guest UI resources', () => {
  it('covers exactly the approved languages with identical key sets', () => {
    expect(Object.keys(guestUi).sort()).toEqual([...guestLocales].sort());
    for (const locale of guestLocales) {
      expect(Object.keys(guestUi[locale]).sort()).toEqual([...guestUiKeys].sort());
      for (const key of guestUiKeys) expect(guestUi[locale][key].trim()).not.toBe('');
    }
  });

  it('keeps the same placeholders for every key in every language', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const locale of guestLocales) {
      for (const key of guestUiKeys)
        expect(placeholders(guestUi[locale][key]), `${locale} ${key}`).toEqual(placeholders(guestUi.en[key]));
    }
  });

  it('names every approved language and degrades safely for anything else', () => {
    for (const locale of guestLocales) expect(languageNames[locale].trim()).not.toBe('');
    expect(guestLocaleName('it')).toBe('it');
    expect(guestUiText('it', 'nav.home')).toBe('Home');
  });

  it('substitutes placeholders in the fallback notice', () => {
    expect(guestUiText('de', 'fallback.notice', { language: 'English' })).toBe(
      'Der Originaltext wird auf English angezeigt.',
    );
    expect(guestUiText('en', 'fallback.notice', { language: 'Deutsch' })).toBe('Showing the original text in Deutsch.');
    expect(guestUiText('sl', 'fallback.notice', { language: 'English' })).toBe(
      'Prikazano je izvirno besedilo v jeziku English.',
    );
    expect(guestUiText('fr', 'fallback.notice', { language: 'English' })).toBe('Texte original affiché en English.');
    expect(guestUiText('es', 'fallback.notice', { language: 'Deutsch' })).toBe(
      'Se muestra el texto original en Deutsch.',
    );
  });

  it('adds ?lang only when a language is given, including the source language', () => {
    expect(guestLink('/g/synthetic/guide', 'en')).toBe('/g/synthetic/guide?lang=en');
    expect(guestLink('/g/synthetic/help', 'sl')).toBe('/g/synthetic/help?lang=sl');
    expect(guestLink('/g/synthetic')).toBe('/g/synthetic');
  });
});

describe('mapSearchUrl', () => {
  it('encodes the whole address into the query parameter', () => {
    expect(mapSearchUrl('Trg 1 #2?a=b&c, Ljubljana')).toBe(
      'https://www.openstreetmap.org/search?query=Trg%201%20%232%3Fa%3Db%26c%2C%20Ljubljana',
    );
    expect(mapSearchUrl('Šmarna gora')).toBe('https://www.openstreetmap.org/search?query=%C5%A0marna%20gora');
  });
});

describe('avatarInitial', () => {
  it('takes the first grapheme, uppercased', () => {
    expect(avatarInitial('  villa Jezero', 'en')).toBe('V');
    expect(avatarInitial('čebelica', 'sl')).toBe('Č');
    expect(avatarInitial('東京ハウス', 'en')).toBe('東');
    expect(avatarInitial('👨‍👩‍👧 Family loft', 'en')).toBe('👨‍👩‍👧');
    expect(avatarInitial('e\u0301cole', 'en')).toBe('E\u0301');
    expect(avatarInitial('   ', 'en')).toBe('');
  });
});

describe('answerHoursText', () => {
  it('uses 24-hour property times and flags spans past midnight', () => {
    expect(answerHoursText('en', '08:00', '21:00', 'Europe/Ljubljana')).toBe(
      'Usually answers 08:00–21:00, Europe/Ljubljana time.',
    );
    expect(answerHoursText('en', '22:00', '02:00', 'UTC')).toBe(
      'Usually answers from 22:00 to 02:00 the next day, UTC time.',
    );
    expect(answerHoursText('de', '20:00', '20:00', 'UTC')).toContain('am nächsten Tag');
  });
});
