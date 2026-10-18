import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { serverEnv, type ServerEnv } from './env.server';

// TLS parameters drive dbClientOptions; leaving them in the URL would let the driver's own
// (weaker) sslmode handling disagree with the explicit ssl options.
export function dbDriverUrl(appDbUrl: string): string {
  const url = new URL(appDbUrl);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslrootcert');
  return url.toString();
}

// Transaction-pooler compatible settings from the start: no prepared statements, small pool.
// Remote connections verify the full chain against the project root CA. env.server.ts already
// rejects missing or weakened modes; a missing CA file fails closed here before any request.
export function dbClientOptions(env: ServerEnv) {
  if (env.appEnv === 'local') {
    return { prepare: false, max: 5, ssl: false };
  }
  if (!env.appDbCaPath) {
    throw new Error('APP_DB_URL must carry the project root CA path outside local');
  }
  return {
    prepare: false,
    max: 5,
    ssl: { ca: readFileSync(env.appDbCaPath, 'utf8'), rejectUnauthorized: true },
  };
}

export const sql = postgres(dbDriverUrl(serverEnv.appDbUrl), dbClientOptions(serverEnv));

// Transaction-local owner context for RLS policies; `set_config(..., true)` resets at commit.
export async function withOwnerContext<T>(
  userId: string,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('app.owner_id', ${userId}, true)`;
    return work(tx);
  });
  return result as T;
}
