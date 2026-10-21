import { createClient } from '@supabase/supabase-js';
import { serverEnv } from './env.server';
import { sql } from './db.server';

const STORAGE_WRITE_TIMEOUT_MS = 15_000;

// storage-js upload takes no signal; reads stay unbounded so a slow guest download is never cut off.
function withWriteDeadline(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method === 'GET' || init?.signal) return fetch(input, init);
  return fetch(input, { ...init, signal: AbortSignal.timeout(STORAGE_WRITE_TIMEOUT_MS) });
}

// The secret key performs I/O only; callers read the image row under RLS first (ADR 0005).
const bucket = serverEnv.supabaseSecretKey
  ? createClient(serverEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: withWriteDeadline },
    }).storage.from('guide-images')
  : null;

export async function putImage(path: string, bytes: Uint8Array): Promise<boolean> {
  if (!bucket) return false;
  const { error } = await bucket.upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  return !error;
}

export async function getImage(path: string): Promise<ReadableStream<Uint8Array> | null> {
  if (!bucket) return null;
  const { data, error } = await bucket.download(path).asStream();
  return error ? null : (data as ReadableStream<Uint8Array>);
}

// Deleting the rows first locks them through the Storage call, so a publish that claims the same path
// either commits first (the row is then skipped) or finds nothing to claim; a failed removal rolls back.
export async function drainStorageDeletions(limit = 50): Promise<number> {
  const storage = bucket;
  if (!storage) return 0;
  return sql
    .begin(async (tx) => {
      const rows = await tx<{ object_path: string }[]>`
        delete from app.storage_deletions where object_path in (
          select object_path from app.storage_deletions where not_before <= now() order by queued_at limit ${limit}
        ) returning object_path
      `;
      if (rows.length === 0) return 0;
      const paths = rows.map((row) => row.object_path);
      const { error } = await storage.remove(paths);
      if (error) throw new Error('storage_remove_failed');
      return paths.length;
    })
    .catch(() => 0);
}

// Stops at an empty queue or the first failed batch; a failure stays queued for the next drain.
export async function drainAllStorageDeletions(): Promise<number> {
  let total = 0;
  for (;;) {
    const drained = await drainStorageDeletions().catch(() => 0);
    if (drained === 0) return total;
    total += drained;
  }
}

export function imageResponse(image: ReadableStream<Uint8Array> | null): Response {
  if (!image) return new Response(null, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return new Response(image, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
    },
  });
}
