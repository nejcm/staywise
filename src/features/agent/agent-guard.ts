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
  ['payment', /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/gi, (match) => match.replace(/[\s-]/g, '').toUpperCase()],
  ['phone', /\+?\p{Nd}[\p{Nd}\s()./_x-]{6,}\p{Nd}/gu, (match) => match.replace(/\P{Nd}/gu, '')],
];

// Comma-separated digit runs: three or more groups, folded only when `+`-prefixed or when the groups are 2-4 digits and
// do not read as thousands grouping, so price lists such as "1,500, 2,300" never join into one phone number.
const commaRun = /(?<![\p{Nd},])(\+?)(\p{Nd}{1,4}(?:,\p{Nd}{1,4}){2,})(?!\p{Nd}|,\p{Nd})/gu;
const thousands = /^\p{Nd}{1,3}(?:,\p{Nd}{3})+$/u;

function foldCommaRun(match: string, plus: string, run: string): string {
  const groups = run.split(',');
  if (!plus && (groups.some((group) => group.length < 2) || thousands.test(run))) return match;
  return plus + groups.join('-');
}

// NFKC folds full-width @ and dots, dropping format characters stops zero-width splits; (dot)/(at) spellings fold too.
// Dashes, minus and middle dots fold to `-` and ideographic full stops to `.`, so Unicode separators cannot split a
// phone number, IBAN or domain. A Unicode dash with whitespace on both sides is prose (`1.200 – 1.500 EUR`) and stays.
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/(?<!\s)[\p{Pd}\u2212\u00b7\u2027\u30fb]|[\p{Pd}\u2212\u00b7\u2027\u30fb](?!\s)/gu, '-')
    .replace(/[\u3002\uff0e\uff61]/gu, '.')
    .replace(commaRun, foldCommaRun)
    .replace(/\s*[([{]\s*(?:dot|\.)\s*[)\]}]\s*/giu, '.')
    .replace(/(?<=[\p{L}\p{N}])\s+\.\s+(?=\p{Ll})/gu, '.')
    .replace(/\s*[([{]\s*at\s*[)\]}]\s*|\s*@\s*/giu, '@');
}

// An ISO date, or a hyphenated range of two (dashes fold to `-`, so `2026-11-01–2026-11-03` must stay one date range).
const isoDate = String.raw`(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`;
// A dotted date (`10.11.2026`, `10. 11. 2026`), optionally after a range start (`10.-12. 11. 2026`, `10.11.-15.11.2026`).
const day = String.raw`(?:0?[1-9]|[12]\d|3[01])\.`;
const month = String.raw`(?:0?[1-9]|1[0-2])\.`;
const dottedDate = String.raw`(?<![\d.])(?:${day}\s?(?:${month}\s?)?-\s?)?${day}\s?${month}\s?(?:19|20)\d{2}(?!\d)`;
const datesAndTimes = new RegExp(
  String.raw`(?<!\d-)\b${isoDate}(?:-${isoDate})?\b(?!-\d)|${dottedDate}|\b(?:[01]?\d|2[0-3]):[0-5]\d\b`,
  'g',
);

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
