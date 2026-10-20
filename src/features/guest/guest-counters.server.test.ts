import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withLinkContext } from '../../lib/db.server';
import { logEvent } from '../../lib/log.server';
import { bumpGuestCounter, bumpRate, utcDay, utcWindow } from './guest-counters.server';

vi.mock('../../lib/db.server', () => ({ withLinkContext: vi.fn() }));
vi.mock('../../lib/log.server', () => ({ logEvent: vi.fn() }));

beforeEach(() => {
  vi.mocked(withLinkContext).mockReset();
  vi.mocked(logEvent).mockReset();
});

describe('windows', () => {
  it('floors to fixed UTC windows regardless of timezone', () => {
    const now = Date.UTC(2026, 9, 21, 13, 45, 12);
    expect(utcWindow(86_400, now).toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(utcWindow(3_600, now).toISOString()).toBe('2026-10-21T13:00:00.000Z');
    expect(utcDay(utcWindow(86_400, now))).toBe('2026-10-21');
  });
});

describe('bumpRate', () => {
  it('returns the incremented count, and fails closed without a row', async () => {
    const tx = vi
      .fn()
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([]);
    const args = ['property-1', Buffer.from('k'), new Date(0)] as const;
    expect(await bumpRate(tx as never, ...args)).toBe(3);
    expect(await bumpRate(tx as never, ...args)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('bumpGuestCounter', () => {
  it.each(['link_exchanges', 'guide_opens', 'submissions'] as const)('upserts a %s counter', async (kind) => {
    const tx = vi.fn().mockResolvedValue([]);
    vi.mocked(withLinkContext).mockImplementation(async (_id, work) => work(tx as never));
    await bumpGuestCounter({ shareId: 's', propertyId: 'p', kind });
    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx.mock.calls[0]![0].join('')).toContain(kind);
  });

  it('swallows failures so a counter can never fail a guest action', async () => {
    vi.mocked(withLinkContext).mockRejectedValue(new Error('db down'));
    await expect(bumpGuestCounter({ shareId: 's', propertyId: 'p', kind: 'guide_opens' })).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith('counter_write_failed', expect.objectContaining({ outcome: 'failed' }));
  });
});
