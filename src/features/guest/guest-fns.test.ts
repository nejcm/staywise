import { describe, expect, it, vi } from 'vitest';
import { readGuestPage } from '../share/share.server';
import { getGuestPage } from './guest-fns';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: (fn: unknown) => fn }) }),
}));
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => new Request('https://synthetic.test/g/x', { headers: { cookie: 'sw_lang=de' } }),
  appendResponseHeader: vi.fn(),
}));
vi.mock('../../lib/log.server', () => ({ logEvent: vi.fn() }));
vi.mock('../share/share.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../share/share.server')>()),
  readGuestPage: vi.fn(),
}));

const call = getGuestPage as unknown as (input: { data: { shareId: string } }) => Promise<unknown>;
const validId = 'A'.repeat(22);

describe('getGuestPage', () => {
  it('denies identically for every invalid link or session and reports thrown reads as error', async () => {
    const malformed = await call({ data: { shareId: 'too-short' } });
    // readGuestPage collapses unknown, disabled, rotated, and expired into one denied (integration-tested).
    vi.mocked(readGuestPage).mockResolvedValue({ state: 'denied' });
    const invalid = await call({ data: { shareId: validId } });
    expect(malformed).toEqual({ state: 'denied', locale: 'de' });
    expect(invalid).toEqual(malformed);
    vi.mocked(readGuestPage).mockRejectedValue(new Error('db down'));
    expect(await call({ data: { shareId: validId } })).toEqual({ state: 'error', locale: 'de' });
  });
});
