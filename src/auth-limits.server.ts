import { createHmac } from 'node:crypto';
import { sql } from './db.server';
import { serverEnv } from './env.server';
import { utcWindow } from './guest-counters.server';

export const otpLimits = { perIp: 5, perEmail: 3, windowSeconds: 900 } as const;

function authFingerprint(scope: string, value: string): Buffer {
  return createHmac('sha256', serverEnv.shareHmacKey).update(`auth-otp:${scope}:${value}`).digest();
}

// Narrowest-first like guest intake: a client over its IP budget does not spend the address's.
// clientIp is null when the platform header is absent (local dev); the address limit still applies.
export async function otpSendAllowed(input: { email: string; clientIp: string | null }): Promise<boolean> {
  const window = utcWindow(otpLimits.windowSeconds);
  return sql.begin(async (tx) => {
    const bump = async (key: Buffer) => {
      const [row] = await tx<{ count: number }[]>`
        insert into app.auth_rate_limits (key_hash, window_start, count) values (${key}, ${window}, 1)
        on conflict (key_hash, window_start) do update set count = app.auth_rate_limits.count + 1
        returning count
      `;
      return row?.count ?? Number.MAX_SAFE_INTEGER;
    };
    if (input.clientIp !== null && (await bump(authFingerprint('ip', input.clientIp))) > otpLimits.perIp) return false;
    return (await bump(authFingerprint('email', input.email.trim().toLowerCase()))) <= otpLimits.perEmail;
  });
}
