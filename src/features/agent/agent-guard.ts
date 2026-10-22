export type AddedContact = 'link' | 'email' | 'phone' | 'payment';

const detectors: [AddedContact, RegExp, (match: string) => string][] = [
  ['email', /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, (match) => match.toLowerCase()],
  [
    'link',
    /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+|(?<![@\p{L}\p{N}.-])(?:[\p{L}\p{N}-]+\.)+\p{L}{2,24}(?![\p{L}\p{N}])(?:\/[^\s<>"']*)?/giu,
    (match) =>
      match
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/^www\./, '')
        .replace(/[/.,;:!?)]+$/, ''),
  ],
  [
    'link',
    /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?!\.?\d)(?:\/[^\s<>"']*)?/g,
    (match) => match.replace(/[/.,;:!?)]+$/, ''),
  ],
  ['payment', /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi, (match) => match.replace(/\s/g, '').toUpperCase()],
  ['phone', /\+?\p{Nd}[\p{Nd}\s()./_x-]{6,}\p{Nd}/gu, (match) => match.replace(/\P{Nd}/gu, '')],
];

// NFKC folds full-width @ and dots, dropping format characters stops zero-width splits; (dot)/(at) spellings fold too.
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s*[([{]\s*(?:dot|\.)\s*[)\]}]\s*/giu, '.')
    .replace(/(?<=[\p{L}\p{N}])\s+\.\s+(?=\p{Ll})/gu, '.')
    .replace(/\s*[([{]\s*at\s*[)\]}]\s*|\s*@\s*/giu, '@');
}

const datesAndTimes =
  /(?<!\d-)\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b(?!-\d)|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g;

function found(text: string, pattern: RegExp, key: (match: string) => string, kind: AddedContact): Set<string> {
  const values = new Set<string>();
  const scanned = kind === 'phone' ? text.replace(datesAndTimes, ' ') : text;
  for (const [match] of scanned.matchAll(pattern)) {
    if (kind === 'phone' && match.replace(/\P{Nd}/gu, '').length < 9) continue;
    values.add(key(match));
  }
  return values;
}

// Agent writes may keep or remove contact and payment details, never add new ones (Q21).
export function addedContact(before: string, after: string): AddedContact | null {
  const was = normalize(before);
  const now = normalize(after);
  for (const [kind, pattern, key] of detectors) {
    const existing = found(was, pattern, key, kind);
    for (const value of found(now, pattern, key, kind)) if (!existing.has(value)) return kind;
  }
  return null;
}
