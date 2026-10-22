import { describe, expect, it, vi } from 'vitest';

// Counting wrapper around the real compare, so denial branches can be compared by call count.
const compareCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    timingSafeEqual: (left: NodeJS.ArrayBufferView, right: NodeJS.ArrayBufferView) => {
      compareCalls.count += 1;
      return actual.timingSafeEqual(left, right);
    },
  };
});

import {
  GUEST_SESSION_SECONDS,
  guestFailure,
  guestSessionToken,
  newShareLink,
  reservationBatchInput,
  resolveGuestLocale,
  serializeGuestCookie,
  serializeLanguageCookie,
  disableShareLink,
  insertShareLink,
  readShareLinkState,
  sessionExpiry,
  shareSecretMatches,
  createStayLink,
  stayLinkInput,
} from './share.server';

const token = 'a'.repeat(43);

describe('share link secrets', () => {
  it('generates a 256-bit secret, a distinct id, and a stored digest', () => {
    const first = newShareLink();
    const second = newShareLink();
    expect(first.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hmac).toHaveLength(32);
    expect(first.id).not.toBe(second.id);
    expect(first.secret).not.toBe(second.secret);
    expect(shareSecretMatches(first.secret, first.hmac)).toBe(true);
  });

  it('accepts only the exact secret and fails closed without a stored digest', () => {
    const { secret, hmac } = newShareLink();
    const tampered = `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
    expect(shareSecretMatches(secret, hmac)).toBe(true);
    expect(shareSecretMatches(tampered, hmac)).toBe(false);
    expect(shareSecretMatches(secret, null)).toBe(false);
    expect(shareSecretMatches('x', null)).toBe(false);
  });

  it('runs the constant-time compare once for wrong, missing, and disabled digests alike', () => {
    const { secret, hmac } = newShareLink();
    const tampered = `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
    const counts: number[] = [];
    for (const [presented, stored] of [
      [tampered, hmac],
      [secret, null],
      [tampered, null],
      [secret, hmac],
    ] as const) {
      compareCalls.count = 0;
      shareSecretMatches(presented, stored);
      counts.push(compareCalls.count);
    }
    expect(counts).toEqual([1, 1, 1, 1]);
  });

  it('serializes the guest cookie with enforced flags and a bounded lifetime', () => {
    expect(serializeGuestCookie(token, true)).toBe(
      `sw_guest=${token}; Max-Age=${GUEST_SESSION_SECONDS}; Path=/g; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(serializeGuestCookie(token, false)).toBe(
      `sw_guest=${token}; Max-Age=${GUEST_SESSION_SECONDS}; Path=/g; HttpOnly; SameSite=Lax`,
    );
  });

  it('reads only well-formed guest tokens from a cookie header', () => {
    expect(guestSessionToken(`sw_guest=${token}`)).toBe(token);
    expect(guestSessionToken(`theme=dark; sw_guest=${token}; other=1`)).toBe(token);
    expect(guestSessionToken('sw_guest=')).toBeNull();
    expect(guestSessionToken('sw_guest=short')).toBeNull();
    expect(guestSessionToken('other=1')).toBeNull();
    expect(guestSessionToken(null)).toBeNull();
    expect(guestSessionToken('')).toBeNull();
  });

  it('resolves ?lang before the remembered cookie before source, ignoring invalid values', () => {
    expect(resolveGuestLocale('de', 'sw_lang=sl')).toEqual({ locale: 'de', remember: 'de' });
    expect(resolveGuestLocale(undefined, 'sw_lang=sl')).toEqual({ locale: 'sl', remember: undefined });
    expect(resolveGuestLocale('xx', 'sw_lang=sl')).toEqual({ locale: 'sl', remember: undefined });
    expect(resolveGuestLocale(undefined, 'sw_lang=%3Cscript')).toEqual({ locale: undefined, remember: undefined });
    expect(resolveGuestLocale(undefined, null)).toEqual({ locale: undefined, remember: undefined });
  });

  it('serializes the language cookie with the decided attributes', () => {
    expect(serializeLanguageCookie('de', true)).toBe(
      'sw_lang=de; Max-Age=15552000; Path=/g; HttpOnly; Secure; SameSite=Lax',
    );
    expect(serializeLanguageCookie('de', false)).not.toContain('Secure');
  });
});

describe('guestFailure', () => {
  it('maps server failures to a retryable error and invalid links or sessions to denied', () => {
    expect(guestFailure({ error: 'unexpected' }, 'de')).toEqual({ state: 'error', locale: 'de' });
    expect(guestFailure({ state: 'denied' }, 'sl')).toEqual({ state: 'denied', locale: 'sl' });
  });
});

describe('stay links', () => {
  it('clamps a guest session to the link expiry', () => {
    const end = Date.parse('2026-10-22T12:00:00Z');
    expect(sessionExpiry(end, null).getTime()).toBe(end);
    expect(sessionExpiry(end, new Date('2026-10-22T08:00:00Z')).toISOString()).toBe('2026-10-22T08:00:00.000Z');
    expect(sessionExpiry(end, new Date('2026-10-23T08:00:00Z')).getTime()).toBe(end);
  });

  it('keeps the property-link functions off stay links', async () => {
    const queries: string[] = [];
    const tx = ((strings: TemplateStringsArray) => {
      const query = strings.join('?');
      queries.push(query);
      return Promise.resolve(query.includes('app.properties') ? [{ id: 'p', published: true }] : []);
    }) as never;
    const propertyId = '11111111-1111-4111-8111-111111111111';
    await readShareLinkState(tx, propertyId);
    await insertShareLink(tx, { propertyId, id: 'a'.repeat(22), hmac: Buffer.alloc(32) });
    await disableShareLink(tx, propertyId);
    const linkQueries = queries.filter((query) => query.includes('app.share_links') && query.includes('enabled'));
    expect(linkQueries.length).toBe(3);
    for (const query of linkQueries) expect(query).toContain("kind = 'property'");
  });
});

describe('stay link length', () => {
  const propertyId = '11111111-1111-4111-8111-111111111111';
  const stay = (stayStart: string, stayEnd: string) =>
    stayLinkInput.safeParse({ propertyId, stayStart, stayEnd }).success;

  it('accepts a same-day stay and one of up to 366 nights, like imported reservations', () => {
    expect(stay('2027-01-10', '2027-01-10')).toBe(true);
    expect(stay('2027-01-10', '2028-01-11')).toBe(true);
  });

  it('refuses a stay longer than 366 nights or ending before it starts', () => {
    expect(stay('2027-01-10', '2028-01-12')).toBe(false);
    expect(stay('2027-01-10', '2037-01-10')).toBe(false);
    expect(stay('2027-01-10', '2027-01-09')).toBe(false);
  });

  it('refuses an over-long stay in the canonical write before any query', async () => {
    const queries: string[] = [];
    const tx = ((strings: TemplateStringsArray) => {
      queries.push(strings.join('?'));
      return Promise.resolve([{ id: 'r' }]);
    }) as never;
    await expect(
      createStayLink(tx, {
        propertyId,
        stayStart: '2027-01-10',
        stayEnd: '2099-12-31',
        id: 'a'.repeat(22),
        hmac: Buffer.alloc(32),
      }),
    ).rejects.toThrow('invalid_input');
    expect(queries).toEqual([]);
  });
});

describe('reservationBatchInput', () => {
  const row = { source: 'airbnb', externalId: 'HM123', stayStart: '2027-01-10', stayEnd: '2027-01-12' };
  const parse = (reservations: unknown[]) =>
    reservationBatchInput.safeParse({ propertyId: '00000000-0000-4000-8000-000000000001', reservations }).success;

  it('accepts 1 to 100 valid rows', () => {
    expect(parse([row])).toBe(true);
    expect(parse(Array.from({ length: 100 }, (_, n) => ({ ...row, externalId: `HM${n}` })))).toBe(true);
  });

  it.each([
    ['an empty batch', []],
    ['101 rows', Array.from({ length: 101 }, (_, n) => ({ ...row, externalId: `HM${n}` }))],
    ['a repeated source and external id', [row, { ...row, stayEnd: '2027-01-13' }]],
    ['check-out before check-in', [{ ...row, stayEnd: '2027-01-09' }]],
    ['a stay over a year', [{ ...row, stayEnd: '2028-02-01' }]],
    ['an invalid date', [{ ...row, stayStart: '2027-02-30' }]],
    ['a guest name', [{ ...row, guestFirstName: 'Ana' }]],
    ['a party size', [{ ...row, partySize: 2 }]],
    ['an uppercase source', [{ ...row, source: 'Airbnb' }]],
    ['a manual stay', [{ ...row, source: 'manual' }]],
    ['a control character', [{ ...row, externalId: `HM${String.fromCodePoint(7)}` }]],
  ])('rejects %s', (_label, reservations) => {
    expect(parse(reservations)).toBe(false);
  });
});
