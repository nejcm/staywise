import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { sql, withOwnerContext } from '../../lib/db.server';
import { serverEnv } from '../../lib/env.server';
import { bearerToken, cleanText, mintPersonalToken, resolveAgentToken } from './agent-auth.server';

vi.mock('../../lib/db.server', () => ({ sql: vi.fn(), withOwnerContext: vi.fn() }));

const grant = {
  grant_id: '00000000-0000-4000-8000-000000000001',
  owner_id: '00000000-0000-4000-8000-000000000002',
  scopes: ['read'],
  property_id: null,
};

function lookupReturns(rows: unknown[]) {
  (sql as unknown as Mock).mockImplementation(() => Promise.resolve(rows));
}

beforeEach(() => {
  (sql as unknown as Mock).mockReset();
  vi.mocked(withOwnerContext).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  serverEnv.agentAccessDisabled = false;
});

describe('personal tokens', () => {
  it('mints sw_pat_ plus 32 random bytes and stores only the SHA-256 digest', () => {
    const { token, digest } = mintPersonalToken();
    expect(token).toMatch(/^sw_pat_[A-Za-z0-9_-]{43}$/);
    expect(digest.equals(createHash('sha256').update(token).digest())).toBe(true);
    expect(mintPersonalToken().token).not.toBe(token);
  });

  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['Bearer', null],
    ['Basic abc', null],
    ['Bearer a b', null],
    [null, null],
  ])('reads the bearer from %j', (header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });
});

describe('resolveAgentToken', () => {
  const { token } = mintPersonalToken();

  it('resolves an active grant to its principal', async () => {
    lookupReturns([{ ...grant, last_used_at: new Date() }]);
    expect(await resolveAgentToken(token, null)).toEqual({
      grantId: grant.grant_id,
      ownerId: grant.owner_id,
      scopes: ['read'],
      propertyId: null,
      kind: 'pat',
    });
  });

  it('denies an unknown, revoked or expired token (the lookup returns no row)', async () => {
    lookupReturns([]);
    expect(await resolveAgentToken(token, null)).toBeNull();
  });

  it.each([null, '', 'sw_pat_short', `ghp_${'A'.repeat(43)}`, `sw_pat_${'A'.repeat(43)}x`])(
    'denies the malformed token %j without a lookup',
    async (candidate) => {
      expect(await resolveAgentToken(candidate, null)).toBeNull();
      expect(sql).not.toHaveBeenCalled();
    },
  );

  it('denies every token while the kill switch is on', async () => {
    serverEnv.agentAccessDisabled = true;
    lookupReturns([{ ...grant, last_used_at: null }]);
    expect(await resolveAgentToken(token, null)).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });

  it('writes last use at most every 10 minutes', async () => {
    lookupReturns([{ ...grant, last_used_at: new Date(Date.now() - 9 * 60 * 1000) }]);
    await resolveAgentToken(token, 'claude-code/2.0');
    expect(withOwnerContext).not.toHaveBeenCalled();
    lookupReturns([{ ...grant, last_used_at: new Date(Date.now() - 11 * 60 * 1000) }]);
    await resolveAgentToken(token, 'claude-code/2.0');
    expect(withOwnerContext).toHaveBeenCalledWith(grant.owner_id, expect.any(Function));
  });
});

const rlo = String.fromCodePoint(0x202e);
const zeroWidth = String.fromCodePoint(0x200b);

describe('cleanText', () => {
  it('strips control, bidi and zero-width characters and caps by code point', () => {
    expect(cleanText(`HM${rlo}txt.exe\u0007${zeroWidth}\n`, 50)).toBe('HMtxt.exe');
    expect(cleanText('😀😀😀', 2)).toBe('😀😀');
  });
});
