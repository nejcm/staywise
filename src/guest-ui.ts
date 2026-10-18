import { guestLocales, type GuestLocale, type SectionCategory } from './guide-validation';

// Guest UI strings for the approved pilot languages. A flat key set keeps parity testable and
// avoids an i18n dependency for a handful of labels; {placeholders} are substituted by
// guestUiText. Host-facing UI stays English.
export const guestUiKeys = [
  'label.guest',
  'nav.home',
  'nav.guide',
  'nav.help',
  'nav.languages',
  'home.heading',
  'home.empty',
  'home.help.title',
  'home.help.body',
  'home.help.open',
  'guide.heading',
  'guide.empty',
  'help.heading',
  'help.emergency.title',
  'help.emergency.fallback',
  'help.contact.title',
  'help.contact.body',
  'fallback.notice',
  'category.arrival',
  'category.wifi',
  'category.parking',
  'category.rules',
  'category.appliances',
  'category.waste',
  'category.checkout',
  'category.emergency',
  'category.local_tips',
] as const;
export type GuestUiKey = (typeof guestUiKeys)[number];

export const guestUi: Record<GuestLocale, Record<GuestUiKey, string>> = {
  en: {
    'label.guest': 'Guest',
    'nav.home': 'Home',
    'nav.guide': 'Guide',
    'nav.help': 'Help',
    'nav.languages': 'Language',
    'home.heading': 'Your stay',
    'home.empty': 'Your host has not published any guide content yet.',
    'home.help.title': 'Need help?',
    'home.help.body': 'Emergency contacts and how to reach your host.',
    'home.help.open': 'Open Help',
    'guide.heading': 'Guide',
    'guide.empty': 'Your host has not published any guide content yet.',
    'help.heading': 'Help',
    'help.emergency.title': 'Emergencies',
    'help.emergency.fallback': 'For a real emergency, contact local emergency services immediately.',
    'help.contact.title': 'Contact your host',
    'help.contact.body':
      'Message or call your host directly if something is wrong or you have a question about your stay.',
    'fallback.notice': 'Showing the original text in {language}.',
    'category.arrival': 'Arrival and access',
    'category.wifi': 'Wi-Fi',
    'category.parking': 'Parking',
    'category.rules': 'House rules',
    'category.appliances': 'Appliances',
    'category.waste': 'Waste and recycling',
    'category.checkout': 'Checkout',
    'category.emergency': 'Emergency contacts',
    'category.local_tips': 'Local tips',
  },
  de: {
    'label.guest': 'Gast',
    'nav.home': 'Start',
    'nav.guide': 'Leitfaden',
    'nav.help': 'Hilfe',
    'nav.languages': 'Sprache',
    'home.heading': 'Ihr Aufenthalt',
    'home.empty': 'Ihr Gastgeber hat noch keine Inhalte veröffentlicht.',
    'home.help.title': 'Brauchen Sie Hilfe?',
    'home.help.body': 'Notfallkontakte und wie Sie Ihren Gastgeber erreichen.',
    'home.help.open': 'Hilfe öffnen',
    'guide.heading': 'Leitfaden',
    'guide.empty': 'Ihr Gastgeber hat noch keine Inhalte veröffentlicht.',
    'help.heading': 'Hilfe',
    'help.emergency.title': 'Notfälle',
    'help.emergency.fallback': 'Wenden Sie sich bei einem echten Notfall sofort an den örtlichen Notdienst.',
    'help.contact.title': 'Kontakt zum Gastgeber',
    'help.contact.body':
      'Schreiben Sie Ihrem Gastgeber oder rufen Sie direkt an, wenn etwas nicht stimmt oder Sie eine Frage zu Ihrem Aufenthalt haben.',
    'fallback.notice': 'Der Originaltext wird auf {language} angezeigt.',
    'category.arrival': 'Anreise und Zugang',
    'category.wifi': 'WLAN',
    'category.parking': 'Parken',
    'category.rules': 'Hausregeln',
    'category.appliances': 'Geräte',
    'category.waste': 'Abfall und Recycling',
    'category.checkout': 'Abreise',
    'category.emergency': 'Notfallkontakte',
    'category.local_tips': 'Tipps vor Ort',
  },
  sl: {
    'label.guest': 'Gost',
    'nav.home': 'Domov',
    'nav.guide': 'Vodič',
    'nav.help': 'Pomoč',
    'nav.languages': 'Jezik',
    'home.heading': 'Vaše bivanje',
    'home.empty': 'Gostitelj še ni objavil vsebine vodnika.',
    'home.help.title': 'Potrebujete pomoč?',
    'home.help.body': 'Nujni kontakti in kako doseči gostitelja.',
    'home.help.open': 'Odpri pomoč',
    'guide.heading': 'Vodič',
    'guide.empty': 'Gostitelj še ni objavil vsebine vodnika.',
    'help.heading': 'Pomoč',
    'help.emergency.title': 'Nujni primeri',
    'help.emergency.fallback': 'Ob resnični nujnosti takoj pokličite lokalne nujne službe.',
    'help.contact.title': 'Stik z gostiteljem',
    'help.contact.body': 'Če je kaj narobe ali imate vprašanje o bivanju, pišite ali pokličite gostitelja.',
    'fallback.notice': 'Prikazano je izvirno besedilo v jeziku {language}.',
    'category.arrival': 'Prihod in dostop',
    'category.wifi': 'Wi-Fi',
    'category.parking': 'Parkirišče',
    'category.rules': 'Hišni red',
    'category.appliances': 'Naprave',
    'category.waste': 'Odpadki in recikliranje',
    'category.checkout': 'Odjava',
    'category.emergency': 'Nujni kontakti',
    'category.local_tips': 'Lokalni nasveti',
  },
};

export const languageNames: Record<GuestLocale, string> = {
  en: 'English',
  de: 'Deutsch',
  sl: 'Slovenščina',
};

function isGuestLocale(locale: string): locale is GuestLocale {
  return (guestLocales as readonly string[]).includes(locale);
}

export function guestLocaleName(locale: string): string {
  return isGuestLocale(locale) ? languageNames[locale] : locale;
}

export function guestUiText(locale: string, key: GuestUiKey, vars?: Record<string, string>): string {
  const dictionary = isGuestLocale(locale) ? guestUi[locale] : guestUi.en;
  let text: string = dictionary[key];
  for (const [name, value] of Object.entries(vars ?? {})) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

export function guestCategoryLabel(locale: string, category: SectionCategory): string {
  return guestUiText(locale, `category.${category}`);
}

// Full-document guest links keep a selected non-source language; the source language alone uses
// the plain path, so the pre-localization URLs stay valid.
export function guestLink(path: string, locale: string, sourceLocale: string): string {
  return locale === sourceLocale ? path : `${path}?lang=${locale}`;
}
