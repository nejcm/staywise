import { guestLocales, type GuestLocale, type SectionCategory } from '../guide/guide-validation';

// Guest UI strings for the approved pilot languages. A flat key set keeps parity testable and
// avoids an i18n dependency for a handful of labels; {placeholders} are substituted by
// guestUiText. Host-facing UI stays English.
export const guestUiKeys = [
  'label.guest',
  'nav.home',
  'nav.guide',
  'nav.help',
  'nav.languages',
  'nav.skip',
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
  'help.form.title',
  'help.form.intro',
  'help.form.privacy',
  'help.privacy.summary',
  'help.privacy.link',
  'form.kind',
  'form.kind.question',
  'form.kind.issue',
  'form.category',
  'form.category.choose',
  'form.categoryRequired',
  'form.body',
  'form.bodyRequired',
  'form.bodyTooLong',
  'form.bodyInvalid',
  'form.replyAsk',
  'form.replyEmail',
  'form.emailInvalid',
  'form.submit',
  'form.sent',
  'form.error',
  'form.rateLimited',
  'form.denied',
  'fallback.notice',
  'open.title',
  'open.body',
  'open.noscript',
  'denied.title',
  'denied.body',
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
    'nav.skip': 'Skip to content',
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
    'help.form.title': 'Message your host',
    'help.form.intro': "Your message goes straight to your host's inbox.",
    'help.form.privacy': 'Do not include door codes, passwords, or card numbers.',
    'help.privacy.summary':
      'Messages and an optional reply email are kept for 90 days or until your host deletes them. The link or QR code is a bearer pass: anyone who has it can open the published guide. Your host can revoke the link or delete the property.',
    'help.privacy.link': 'Privacy and data handling',
    'form.kind': 'What do you need?',
    'form.kind.question': 'I have a question',
    'form.kind.issue': 'Something is wrong',
    'form.category': 'What is it about?',
    'form.category.choose': 'Choose a topic',
    'form.categoryRequired': 'Choose a topic.',
    'form.body': 'Your message',
    'form.bodyRequired': 'Write your message.',
    'form.bodyTooLong': 'Your message is too long.',
    'form.bodyInvalid': 'Remove hidden special characters from your message.',
    'form.replyAsk': 'I would like a reply by email',
    'form.replyEmail': 'Your email address',
    'form.emailInvalid': 'Enter a valid email address or leave it empty.',
    'form.submit': 'Send message',
    'form.sent': 'Your message was sent to your host.',
    'form.error': 'Your message could not be sent. Please try again.',
    'form.rateLimited': 'Too many messages right now. Please try again later.',
    'form.denied': 'This page cannot send messages. Ask your host for a new link.',
    'fallback.notice': 'Showing the original text in {language}.',
    'open.title': 'Opening your guide…',
    'open.body': 'Stay on this page while we check your link.',
    'open.noscript': 'This guide needs JavaScript to open the link. Ask your host to resend it.',
    'denied.title': "This link can't be opened",
    'denied.body': 'Ask your host to send you a new link.',
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
    'nav.skip': 'Zum Inhalt springen',
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
    'help.form.title': 'Nachricht an Ihren Gastgeber',
    'help.form.intro': 'Ihre Nachricht geht direkt in den Posteingang Ihres Gastgebers.',
    'help.form.privacy': 'Schreiben Sie keine Türcodes, Passwörter oder Kartennummern hinein.',
    'help.privacy.summary':
      'Nachrichten und eine freiwillige Antwortadresse werden 90 Tage lang oder bis zur Löschung durch Ihren Gastgeber gespeichert. Der Link bzw. QR-Code ist ein Zugangsschlüssel: Wer ihn hat, kann den veröffentlichten Leitfaden öffnen. Ihr Gastgeber kann den Link widerrufen oder die Unterkunft löschen.',
    'help.privacy.link': 'Datenschutz und Datenverarbeitung',
    'form.kind': 'Was brauchen Sie?',
    'form.kind.question': 'Ich habe eine Frage',
    'form.kind.issue': 'Etwas ist nicht in Ordnung',
    'form.category': 'Worum geht es?',
    'form.category.choose': 'Thema wählen',
    'form.categoryRequired': 'Bitte wählen Sie ein Thema.',
    'form.body': 'Ihre Nachricht',
    'form.bodyRequired': 'Bitte schreiben Sie Ihre Nachricht.',
    'form.bodyTooLong': 'Ihre Nachricht ist zu lang.',
    'form.bodyInvalid': 'Entfernen Sie unsichtbare Sonderzeichen aus Ihrer Nachricht.',
    'form.replyAsk': 'Ich möchte eine Antwort per E-Mail',
    'form.replyEmail': 'Ihre E-Mail-Adresse',
    'form.emailInvalid': 'Geben Sie eine gültige E-Mail-Adresse ein oder lassen Sie das Feld leer.',
    'form.submit': 'Nachricht senden',
    'form.sent': 'Ihre Nachricht wurde an Ihren Gastgeber gesendet.',
    'form.error': 'Ihre Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es erneut.',
    'form.rateLimited': 'Zu viele Nachrichten im Moment. Bitte versuchen Sie es später erneut.',
    'form.denied':
      'Auf dieser Seite können keine Nachrichten gesendet werden. Bitten Sie Ihren Gastgeber um einen neuen Link.',
    'fallback.notice': 'Der Originaltext wird auf {language} angezeigt.',
    'open.title': 'Ihr Gästeführer wird geöffnet…',
    'open.body': 'Bleiben Sie auf dieser Seite, während wir Ihren Link prüfen.',
    'open.noscript':
      'Dieser Gästeführer braucht JavaScript, um den Link zu öffnen. Bitten Sie Ihren Gastgeber, ihn erneut zu senden.',
    'denied.title': 'Dieser Link kann nicht geöffnet werden',
    'denied.body': 'Bitten Sie Ihren Gastgeber um einen neuen Link.',
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
    'nav.skip': 'Pojdi na vsebino',
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
    'help.form.title': 'Sporočilo gostitelju',
    'help.form.intro': 'Vaše sporočilo gre naravnost v gostiteljev predal.',
    'help.form.privacy': 'Ne vpisujte kod za vrata, gesel ali številk kartic.',
    'help.privacy.summary':
      'Sporočila in neobvezni e-poštni naslov za odgovor se hranijo 90 dni ali do izbrisa s strani gostitelja. Povezava ali koda QR je prenosljiv ključ: vsak, ki jo ima, lahko odpre objavljeni vodič. Gostitelj lahko povezavo prekliče ali izbriše nastanitev.',
    'help.privacy.link': 'Zasebnost in obdelava podatkov',
    'form.kind': 'Kaj potrebujete?',
    'form.kind.question': 'Imam vprašanje',
    'form.kind.issue': 'Nekaj ni v redu',
    'form.category': 'O čem gre?',
    'form.category.choose': 'Izberite temo',
    'form.categoryRequired': 'Izberite temo.',
    'form.body': 'Vaše sporočilo',
    'form.bodyRequired': 'Napišite svoje sporočilo.',
    'form.bodyTooLong': 'Vaše sporočilo je predolgo.',
    'form.bodyInvalid': 'Iz sporočila odstranite nevidne posebne znake.',
    'form.replyAsk': 'Želim odgovor po e-pošti',
    'form.replyEmail': 'Vaš e-poštni naslov',
    'form.emailInvalid': 'Vnesite veljaven e-poštni naslov ali pustite prazno.',
    'form.submit': 'Pošlji sporočilo',
    'form.sent': 'Vaše sporočilo je bilo poslano gostitelju.',
    'form.error': 'Sporočila ni bilo mogoče poslati. Poskusite znova.',
    'form.rateLimited': 'Trenutno je preveč sporočil. Poskusite pozneje.',
    'form.denied': 'S te strani ni mogoče pošiljati sporočil. Prosite gostitelja za novo povezavo.',
    'fallback.notice': 'Prikazano je izvirno besedilo v jeziku {language}.',
    'open.title': 'Odpiramo vaš vodič…',
    'open.body': 'Ostanite na tej strani, medtem ko preverjamo povezavo.',
    'open.noscript': 'Ta vodič za odpiranje povezave potrebuje JavaScript. Prosite gostitelja, naj jo pošlje znova.',
    'denied.title': 'Te povezave ni mogoče odpreti',
    'denied.body': 'Prosite gostitelja za novo povezavo.',
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

export function isGuestLocale(locale: string): locale is GuestLocale {
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

// A language-switch link always names its language so an explicit choice beats the remembered one.
export function guestLink(path: string, lang?: string): string {
  return lang ? `${path}?lang=${lang}` : path;
}

export function firstLine(body: string): string {
  return (
    body
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? ''
  );
}
