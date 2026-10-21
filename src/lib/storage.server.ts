import { createClient } from '@supabase/supabase-js';
import { serverEnv } from './env.server';
import { sql } from './db.server';

// The secret key performs I/O only; callers read the image row under RLS first (ADR 0005).
const bucket = serverEnv.supabaseSecretKey
  ? createClient(serverEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
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

// Storage reports only the objects it removed, so a path already gone still clears its queue row.
export async function drainStorageDeletions(limit = 50): Promise<number> {
  if (!bucket) return 0;
  const rows = await sql<{ object_path: string }[]>`
    select object_path from app.storage_deletions order by queued_at limit ${limit}
  `;
  if (rows.length === 0) return 0;
  const paths = rows.map((row) => row.object_path);
  const { error } = await bucket.remove(paths);
  if (error) return 0;
  await sql`delete from app.storage_deletions where object_path in ${sql(paths)}`;
  return paths.length;
}
