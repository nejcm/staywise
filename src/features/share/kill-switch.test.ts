import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withLinkContext } from '../../lib/db.server';
import { bumpGuestCounter } from '../guest/guest-counters.server';
import { submitGuestMessage } from '../messages/messages.server';
import { exchangeGuestLink, readGuestPage, withActiveGuestLink } from './share.server';

const killSwitch = vi.hoisted(() => ({ on: true }));
vi.mock('../../lib/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/env.server')>();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      get guestAccessDisabled() {
        return killSwitch.on;
      },
    },
  };
});
vi.mock('../../lib/db.server', () => ({ withLinkContext: vi.fn() }));
vi.mock('../guest/guest-counters.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../guest/guest-counters.server')>()),
  bumpGuestCounter: vi.fn(),
}));

const shareId = 'share-id-0123456789';
const secret = 'a'.repeat(43);
const message = {
  kind: 'question',
  category: 'wifi',
  locale: 'en',
  body: 'Where is the router?',
  replyEmail: '',
} as const;

beforeEach(() => {
  vi.mocked(withLinkContext).mockReset().mockResolvedValue(null);
  vi.mocked(bumpGuestCounter).mockReset();
});

describe('kill switch on', () => {
  beforeEach(() => {
    killSwitch.on = true;
  });

  it('denies the link exchange before touching the database', async () => {
    expect(await exchangeGuestLink({ shareId, secret })).toBeNull();
    expect(withLinkContext).not.toHaveBeenCalled();
    expect(bumpGuestCounter).not.toHaveBeenCalled();
  });

  it('denies an active-link check without running the work', async () => {
    const work = vi.fn();
    expect(await withActiveGuestLink({ shareId, sessionToken: secret }, work)).toBeNull();
    expect(work).not.toHaveBeenCalled();
    expect(withLinkContext).not.toHaveBeenCalled();
  });

  it('denies a guest page read', async () => {
    expect(await readGuestPage({ shareId, sessionToken: secret })).toEqual({ state: 'denied' });
    expect(bumpGuestCounter).not.toHaveBeenCalled();
    expect(withLinkContext).not.toHaveBeenCalled();
  });

  it('denies stay links through the same entry points', async () => {
    const stayShareId = 'stay-link-0123456789';
    expect(await exchangeGuestLink({ shareId: stayShareId, secret })).toBeNull();
    expect(await readGuestPage({ shareId: stayShareId, sessionToken: secret })).toEqual({ state: 'denied' });
    expect(withLinkContext).not.toHaveBeenCalled();
  });

  it('denies message intake', async () => {
    expect(await submitGuestMessage({ shareId, sessionToken: secret, message })).toEqual({ state: 'denied' });
    expect(withLinkContext).not.toHaveBeenCalled();
  });
});

describe('kill switch off', () => {
  beforeEach(() => {
    killSwitch.on = false;
  });

  it.each([
    ['exchange', () => exchangeGuestLink({ shareId, secret })],
    ['active link', () => withActiveGuestLink({ shareId, sessionToken: secret }, vi.fn())],
    ['page read', () => readGuestPage({ shareId, sessionToken: secret })],
    ['message intake', () => submitGuestMessage({ shareId, sessionToken: secret, message })],
  ])('reaches the database for %s', async (_name, call) => {
    await call();
    expect(withLinkContext).toHaveBeenCalledWith(shareId, expect.any(Function));
  });
});

describe('guest entry points', () => {
  // Every guest route must honor GUEST_ACCESS_DISABLED (README kill switch); add its case above before listing it here.
  it('match the known set', () => {
    const routes = readdirSync(fileURLToPath(new URL('../../routes', import.meta.url))).filter((name) =>
      name.startsWith('g.'),
    );
    expect(routes.toSorted()).toEqual(
      [
        'g.$shareId.tsx',
        'g.$shareId.index.tsx',
        'g.$shareId.guide.tsx',
        'g.$shareId.guide_.$index.tsx',
        'g.$shareId.help.tsx',
        'g.$shareId_.exchange.ts',
        'g.$shareId_.message.ts',
      ].toSorted(),
    );
  });
});
