import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sql, bucket, createClient, env } = vi.hoisted(() => {
  const storageBucket = { upload: vi.fn(), download: vi.fn(), remove: vi.fn() };
  return {
    sql: vi.fn(),
    bucket: storageBucket,
    createClient: vi.fn((..._args: unknown[]) => ({ storage: { from: () => storageBucket } })),
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
  createClient.mockClear();
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

  it('bounds writes with a deadline but leaves streamed reads open', async () => {
    await import('./storage.server');
    const options = createClient.mock.calls[0]?.at(2) as unknown as { global: { fetch: typeof fetch } };
    const seen: (AbortSignal | null | undefined)[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      seen.push(init?.signal);
      return Promise.resolve(new Response(null));
    });
    await options.global.fetch('http://storage.test/a', { method: 'POST' });
    await options.global.fetch('http://storage.test/a', { method: 'DELETE' });
    await options.global.fetch('http://storage.test/a');
    spy.mockRestore();
    expect(seen.map((signal) => signal instanceof AbortSignal)).toEqual([true, true, false]);
  });

  it('drains due paths and clears them only after Storage accepts the removal', async () => {
    const { drainStorageDeletions } = await import('./storage.server');
    bucket.remove.mockResolvedValue({ data: [{ name: 'p/a.jpg' }], error: null });
    expect(await drainStorageDeletions()).toBe(2);
    expect(String(sql.mock.calls[0]?.[0])).toContain('where not_before <= now()');
    expect(bucket.remove).toHaveBeenCalledWith(['p/a.jpg', 'p/b.jpg']);
    expect(sql).toHaveBeenCalledWith(['p/a.jpg', 'p/b.jpg']);

    sql.mockClear();
    bucket.remove.mockResolvedValue({ data: null, error: new Error('storage down SYNTHETIC') });
    expect(await drainStorageDeletions()).toBe(0);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('drains every batch until the queue is empty or a batch fails', async () => {
    const { drainAllStorageDeletions } = await import('./storage.server');
    let selects = 0;
    sql.mockImplementation((strings: unknown) => {
      if (!(Array.isArray(strings) && String(strings[0]).includes('select'))) return [];
      selects += 1;
      return selects <= 2 ? queued : [];
    });
    bucket.remove.mockResolvedValue({ data: [], error: null });
    expect(await drainAllStorageDeletions()).toBe(4);

    selects = 0;
    bucket.remove.mockResolvedValue({ data: null, error: new Error('storage down SYNTHETIC') });
    expect(await drainAllStorageDeletions()).toBe(0);
    expect(selects).toBe(1);
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
