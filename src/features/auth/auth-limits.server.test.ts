import { beforeEach, describe, expect, it, vi } from 'vitest';
import { otpLimits, otpSendAllowed } from './auth-limits.server';

const { begin } = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock('../../lib/db.server', () => ({ sql: { begin } }));

function counts(...values: (number | null)[]) {
  const tx = vi.fn();
  for (const value of values) tx.mockResolvedValueOnce(value === null ? [] : [{ count: value }]);
  begin.mockImplementation(async (work: (tx: unknown) => unknown) => work(tx));
  return tx;
}

beforeEach(() => {
  begin.mockReset();
});

describe('otpSendAllowed', () => {
  const input = { email: 'Host@Example.test ', clientIp: '203.0.113.9' };

  it('allows a send inside both budgets', async () => {
    const tx = counts(1, 1);
    expect(await otpSendAllowed(input)).toBe(true);
    expect(tx).toHaveBeenCalledTimes(2);
  });

  it('stops at the IP budget without spending the address budget', async () => {
    const tx = counts(otpLimits.perIp + 1);
    expect(await otpSendAllowed(input)).toBe(false);
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it('denies once the address budget is exceeded', async () => {
    counts(1, otpLimits.perEmail + 1);
    expect(await otpSendAllowed(input)).toBe(false);
  });

  it('applies only the address limit when the client IP is unknown', async () => {
    const tx = counts(otpLimits.perEmail);
    expect(await otpSendAllowed({ ...input, clientIp: null })).toBe(true);
    expect(tx).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the counter returns no row', async () => {
    counts(null);
    expect(await otpSendAllowed(input)).toBe(false);
  });

  it('keys the address limit case- and whitespace-insensitively', async () => {
    const keys: unknown[] = [];
    const tx = vi.fn(async (_strings: TemplateStringsArray, key: unknown) => {
      keys.push(key);
      return [{ count: 1 }];
    });
    begin.mockImplementation(async (work: (tx: unknown) => unknown) => work(tx));
    await otpSendAllowed({ email: 'Host@Example.test ', clientIp: null });
    await otpSendAllowed({ email: 'host@example.test', clientIp: null });
    expect(keys[0]).toEqual(keys[1]);
  });
});
