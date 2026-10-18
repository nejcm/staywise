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
  guestSessionToken,
  newShareLink,
  serializeGuestCookie,
  shareSecretMatches,
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
});
