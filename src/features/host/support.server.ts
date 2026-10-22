import { createHmac } from 'node:crypto';
import { sql } from '../../lib/db.server';
import { serverEnv } from '../../lib/env.server';
import { utcWindow } from '../guest/guest-counters.server';

const supportLimits = { perHost: 5, windowSeconds: 3600 } as const;

// HMAC window in auth_rate_limits, purged by the existing cleanup like OTP and agent windows.
export async function supportRequestAllowed(ownerId: string): Promise<boolean> {
  const key = createHmac('sha256', serverEnv.shareHmacKey).update(`support:host:${ownerId}`).digest();
  const [row] = await sql<{ count: number }[]>`
    insert into app.auth_rate_limits (key_hash, window_start, count)
    values (${key}, ${utcWindow(supportLimits.windowSeconds)}, 1)
    on conflict (key_hash, window_start) do update set count = app.auth_rate_limits.count + 1
    returning count
  `;
  return (row?.count ?? Number.MAX_SAFE_INTEGER) <= supportLimits.perHost;
}
