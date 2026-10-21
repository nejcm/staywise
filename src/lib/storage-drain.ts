// Operator drain for queued Storage deletions, e.g. after a restore: `bun run storage:drain`.
import { sql } from './db.server';
import { serverEnv } from './env.server';
import { drainAllStorageDeletions } from './storage.server';

if (!serverEnv.supabaseSecretKey) {
  console.error('SUPABASE_SECRET_KEY is not set; nothing was drained.');
  process.exitCode = 1;
} else {
  const drained = await drainAllStorageDeletions();
  const [left] = await sql<
    { n: number }[]
  >`select count(*)::int as n from app.storage_deletions where not_before <= now()`;
  console.log(`Removed ${drained} queued objects; ${left?.n ?? 0} still queued.`);
  if (left?.n) process.exitCode = 1;
}
await sql.end({ timeout: 5 });
