import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withActiveGuestLink } from '../features/share/share.server';
import { bumpGuestCounter } from '../features/guest/guest-counters.server';
import { logEvent } from '../lib/log.server';
import { getImage } from '../lib/storage.server';
import { Route } from './g.$shareId_.hero';

vi.mock('../features/share/share.server', () => ({
  guestSessionToken: (cookie: string | null) => cookie,
  withActiveGuestLink: vi.fn(),
}));
vi.mock('../features/guide/guide.server', () => ({ readHeroPath: vi.fn() }));
vi.mock('../features/guest/guest-counters.server', () => ({ bumpGuestCounter: vi.fn() }));
vi.mock('../lib/log.server', () => ({ logEvent: vi.fn() }));
vi.mock('../lib/storage.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage.server')>()),
  getImage: vi.fn(),
}));

type Handler = (ctx: { request: Request; params: { shareId: string } }) => Promise<Response>;
const { GET } = (Route.options as unknown as { server: { handlers: { GET: Handler } } }).server.handlers;

const read = () =>
  GET({
    request: new Request('http://localhost/g/share-id-0123456789/hero?v=1', { headers: { cookie: 'token' } }),
    params: { shareId: 'share-id-0123456789' },
  });

beforeEach(() => {
  vi.mocked(withActiveGuestLink).mockReset();
  vi.mocked(getImage).mockReset();
});

describe('guest hero', () => {
  it('streams the hero with private caching and no sniffing', async () => {
    vi.mocked(withActiveGuestLink).mockResolvedValue('p/a.jpg');
    vi.mocked(getImage).mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8])]).stream());
    const response = await read();
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/jpeg',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
    });
    expect(withActiveGuestLink).toHaveBeenCalledWith(
      { shareId: 'share-id-0123456789', sessionToken: 'token' },
      expect.any(Function),
    );
    expect(getImage).toHaveBeenCalledWith('p/a.jpg');
  });

  it('answers every failure with the same bodiless 404 and no counter or log', async () => {
    const failures = [
      () => vi.mocked(withActiveGuestLink).mockResolvedValue(null),
      () => vi.mocked(withActiveGuestLink).mockResolvedValue('p/a.jpg') && vi.mocked(getImage).mockResolvedValue(null),
      () => vi.mocked(withActiveGuestLink).mockRejectedValue(new Error('db down')),
    ];
    for (const fail of failures) {
      fail();
      const response = await read();
      expect(response.status).toBe(404);
      expect(response.body).toBeNull();
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(bumpGuestCounter).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
