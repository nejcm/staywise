import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sql, bucket, createClient, env } = vi.hoisted(() => {
  const storageBucket = { upload: vi.fn(), download: vi.fn(), remove: vi.fn() };
  return {
    sql: vi.fn(),
    bucket: storageBucket,
    createClient: vi.fn(() => ({ storage: { from: () => storageBucket } })),
    env: { supabaseUrl: 'http://127.0.0.1:54321', supabaseSecretKey: 'sb_secret_SYNTHETIC' as string | null },
  };
});
vi.mock('./db.server', () => ({ sql }));
vi.mock('./env.server', () => ({ serverEnv: env }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const queued = [{ object_path: 'p/a.jpg' }, { object_path: 'p/b.jpg' }];

beforeEach(() => {
  vi.resetModules();
  env.supabaseSecretKey = 'sb_secret_SYNTHETIC';
  sql.mockReset();
  for (const fn of Object.values(bucket)) fn.mockReset();
  sql.mockImplementation((strings: unknown) =>
    Array.isArray(strings) && 'raw' in strings && String(strings[0]).includes('select') ? queued : [],
  );
});

describe('storage', () => {
  it('uploads into the private bucket as JPEG without overwriting', async () => {
    const { putImage } = await import('./storage.server');
    bucket.upload.mockResolvedValue({ data: {}, error: null });
    expect(await putImage('p/a.jpg', new Uint8Array([1]))).toBe(true);
    expect(bucket.upload).toHaveBeenCalledWith('p/a.jpg', new Uint8Array([1]), {
      contentType: 'image/jpeg',
      upsert: false,
    });
  });

  it('drains queued paths and clears them only after Storage accepts the removal', async () => {
    const { drainStorageDeletions } = await import('./storage.server');
    bucket.remove.mockResolvedValue({ data: [{ name: 'p/a.jpg' }], error: null });
    expect(await drainStorageDeletions()).toBe(2);
    expect(bucket.remove).toHaveBeenCalledWith(['p/a.jpg', 'p/b.jpg']);
    expect(sql).toHaveBeenCalledWith(['p/a.jpg', 'p/b.jpg']);

    sql.mockClear();
    bucket.remove.mockResolvedValue({ data: null, error: new Error('storage down SYNTHETIC') });
    expect(await drainStorageDeletions()).toBe(0);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('streams a stored object and reports a missing one as null', async () => {
    const { getImage } = await import('./storage.server');
    const stream = new ReadableStream<Uint8Array>();
    bucket.download.mockReturnValue({ asStream: () => Promise.resolve({ data: stream, error: null }) });
    expect(await getImage('p/a.jpg')).toBe(stream);
    bucket.download.mockReturnValue({ asStream: () => Promise.resolve({ data: null, error: new Error('not found') }) });
    expect(await getImage('p/missing.jpg')).toBeNull();
  });

  it('does nothing without the secret key', async () => {
    env.supabaseSecretKey = null;
    const { drainStorageDeletions, getImage, putImage } = await import('./storage.server');
    expect(await putImage('p/a.jpg', new Uint8Array([1]))).toBe(false);
    expect(await getImage('p/a.jpg')).toBeNull();
    expect(await drainStorageDeletions()).toBe(0);
    expect(sql).not.toHaveBeenCalled();
    expect(bucket.upload).not.toHaveBeenCalled();
  });
});
