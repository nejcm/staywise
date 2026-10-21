import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverEnv } from '../lib/env.server';
import { aal2Host } from '../lib/fn-guards.server';
import { ownsProperty, readHeroPath, upsertHero } from '../features/guide/guide.server';
import { withOwnerContext } from '../lib/db.server';
import { drainStorageDeletions, getImage, putImage, removeImage } from '../lib/storage.server';
import { Route } from './host_.properties.$propertyId_.hero';

vi.mock('../lib/fn-guards.server', () => ({ aal2Host: vi.fn() }));
vi.mock('../lib/db.server', () => ({ withOwnerContext: vi.fn() }));
vi.mock('../features/guide/guide.server', () => ({
  heroObjectPath: (id: string) => `${id}/new.jpg`,
  ownsProperty: vi.fn(),
  readHeroPath: vi.fn(),
  upsertHero: vi.fn(),
}));
vi.mock('../lib/storage.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage.server')>()),
  putImage: vi.fn(),
  removeImage: vi.fn(),
  getImage: vi.fn(),
  drainStorageDeletions: vi.fn(),
}));

type Handler = (ctx: { request: Request; params: { propertyId: string } }) => Promise<Response>;
const { POST, GET } = (Route.options as unknown as { server: { handlers: { POST: Handler; GET: Handler } } }).server
  .handlers;

const propertyId = '0b0b0000-0000-4000-8000-0000000000a2';
const jpeg = readFileSync(new URL('../tests/fixtures/synthetic-hero.jpg', import.meta.url));
const hero = { alt: 'Lake view', width: 24, height: 16, version: '1' };

function upload(body: Uint8Array, headers: Record<string, string> = {}) {
  const request = new Request(`http://localhost/host/properties/${propertyId}/hero`, {
    method: 'POST',
    headers: {
      origin: serverEnv.appOrigin,
      'content-type': 'image/jpeg',
      'x-hero-alt': encodeURIComponent('Lake view'),
      ...headers,
    },
    body: new Uint8Array(body),
  });
  return POST({ request, params: { propertyId } });
}

const withExif = Buffer.concat([
  jpeg.subarray(0, 2),
  Buffer.from([0xff, 0xe1, 0, 8]),
  Buffer.from('Exif\0\0'),
  jpeg.subarray(2),
]);

beforeEach(() => {
  serverEnv.supabaseSecretKey = 'sb_secret_SYNTHETIC';
  vi.mocked(aal2Host)
    .mockReset()
    .mockResolvedValue({ userId: 'u1', email: 'host@example.test' } as never);
  vi.mocked(withOwnerContext)
    .mockReset()
    .mockImplementation((_userId, work) => work({} as never));
  vi.mocked(ownsProperty).mockReset().mockResolvedValue(true);
  vi.mocked(upsertHero).mockReset().mockResolvedValue(hero);
  vi.mocked(removeImage).mockReset().mockResolvedValue(true);
  vi.mocked(readHeroPath).mockReset();
  vi.mocked(putImage).mockReset().mockResolvedValue(true);
  vi.mocked(getImage).mockReset();
  vi.mocked(drainStorageDeletions).mockReset().mockResolvedValue(1);
});

describe('hero upload', () => {
  it('stores a stripped JPEG with its measured size, then drains replaced objects', async () => {
    const response = await upload(jpeg);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'ok', hero });
    expect(putImage).toHaveBeenCalledWith(`${propertyId}/new.jpg`, new Uint8Array(jpeg));
    expect(upsertHero).toHaveBeenCalledWith({}, `${propertyId}/new.jpg`, {
      propertyId,
      alt: 'Lake view',
      width: 24,
      height: 16,
      bytes: jpeg.byteLength,
    });
    expect(vi.mocked(putImage).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(upsertHero).mock.invocationCallOrder[0] ?? 0,
    );
    expect(removeImage).not.toHaveBeenCalled();
    expect(drainStorageDeletions).toHaveBeenCalledOnce();
  });

  it.each([
    ['a cross-origin request', jpeg, { origin: 'https://evil.example' }, 403],
    ['a non-JPEG content type', jpeg, { 'content-type': 'image/png' }, 400],
    ['a missing alt text', jpeg, { 'x-hero-alt': '' }, 400],
    ['a malformed alt encoding', jpeg, { 'x-hero-alt': '%E0%A4%A' }, 400],
    ['an oversized declared length', jpeg, { 'content-length': '1048577' }, 413],
    ['an oversized body', new Uint8Array(1048577), {}, 413],
    ['an Exif JPEG', withExif, {}, 400],
    ['a PNG renamed to JPEG', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {}, 400],
  ])('rejects %s before any write', async (_name, body, headers, status) => {
    expect((await upload(body, headers)).status).toBe(status);
    expect(upsertHero).not.toHaveBeenCalled();
    expect(putImage).not.toHaveBeenCalled();
  });

  it('denies an AAL1 or signed-out host', async () => {
    vi.mocked(aal2Host).mockResolvedValue({ error: 'auth_required' });
    expect((await upload(jpeg)).status).toBe(403);
    expect(upsertHero).not.toHaveBeenCalled();
  });

  it('denies a property the host does not own before uploading', async () => {
    vi.mocked(ownsProperty).mockResolvedValue(false);
    expect((await upload(jpeg)).status).toBe(403);
    expect(putImage).not.toHaveBeenCalled();
  });

  it('removes the new object when the property disappears before the row write', async () => {
    vi.mocked(upsertHero).mockResolvedValue(null);
    expect((await upload(jpeg)).status).toBe(403);
    expect(removeImage).toHaveBeenCalledWith(`${propertyId}/new.jpg`);
  });

  it.each([
    ['rejects', () => vi.mocked(putImage).mockResolvedValue(false)],
    ['throws', () => vi.mocked(putImage).mockRejectedValue(new Error('timeout'))],
  ])('keeps the old hero row when Storage %s the upload', async (_name, arrange) => {
    arrange();
    expect((await upload(jpeg)).status).toBe(500);
    expect(upsertHero).not.toHaveBeenCalled();
    expect(removeImage).toHaveBeenCalledWith(`${propertyId}/new.jpg`);
    expect(drainStorageDeletions).not.toHaveBeenCalled();
  });

  it.each([
    ['rolled back', `${propertyId}/old.jpg`, true],
    ['committed despite the error', `${propertyId}/new.jpg`, false],
  ])(
    'after a failed commit that %s, removes the new object only if no row references it',
    async (_name, current, removed) => {
      vi.mocked(withOwnerContext)
        .mockImplementationOnce((_userId, work) => work({} as never))
        .mockImplementationOnce(async (_userId, work) => {
          await work({} as never);
          throw new Error('commit failed');
        });
      vi.mocked(readHeroPath).mockResolvedValue(current);
      expect((await upload(jpeg)).status).toBe(500);
      expect(readHeroPath).toHaveBeenCalledWith({}, propertyId);
      expect(vi.mocked(removeImage).mock.calls).toEqual(removed ? [[`${propertyId}/new.jpg`]] : []);
      expect(drainStorageDeletions).not.toHaveBeenCalled();
    },
  );

  it('keeps the new object when the re-check itself fails', async () => {
    vi.mocked(upsertHero).mockRejectedValue(new Error('connection lost'));
    vi.mocked(readHeroPath).mockRejectedValue(new Error('connection lost'));
    expect((await upload(jpeg)).status).toBe(500);
    expect(removeImage).not.toHaveBeenCalled();
  });

  it('reports the feature unavailable without the secret key', async () => {
    serverEnv.supabaseSecretKey = null;
    expect((await upload(jpeg)).status).toBe(503);
    expect(aal2Host).not.toHaveBeenCalled();
  });
});

describe('host hero read', () => {
  const read = () => GET({ request: new Request('http://localhost/'), params: { propertyId } });

  it('streams the owner hero as a private JPEG', async () => {
    vi.mocked(readHeroPath).mockResolvedValue(`${propertyId}/a.jpg`);
    vi.mocked(getImage).mockResolvedValue(new Blob([jpeg]).stream());
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers a bodiless 404 for AAL1, a missing row, or a missing object', async () => {
    vi.mocked(aal2Host).mockResolvedValueOnce({ error: 'auth_required' });
    vi.mocked(readHeroPath).mockResolvedValueOnce(null).mockResolvedValueOnce(`${propertyId}/gone.jpg`);
    vi.mocked(getImage).mockResolvedValue(null);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await read();
      expect(response.status).toBe(404);
      expect(response.body).toBeNull();
    }
    expect(readHeroPath).toHaveBeenCalledTimes(2);
  });
});
