import type postgres from 'postgres';
import { withLinkContext } from './db.server';
import { appEnv } from './env.server';
import { logEvent } from './log.server';

// Per-property UTC-day aggregates only: no guest identifiers, no third-party analytics. Bumps are
// best-effort on purpose — a counter failure must never alter or fail a guest action.

export type GuestCounterKind = 'link_exchanges' | 'guide_opens' | 'submissions';

// Fixed UTC windows keyed to epoch multiples keep windows and aggregates deterministic regardless
// of the server's local timezone.
export function utcWindow(seconds: number, now = Date.now()): Date {
  return new Date(Math.floor(now / 1000 / seconds) * seconds * 1000);
}

export function utcDay(start: Date = utcWindow(86_400)): string {
  return start.toISOString().slice(0, 10);
}

async function upsertCounter(tx: postgres.TransactionSql, propertyId: string, kind: GuestCounterKind): Promise<void> {
  const day = utcDay();
  if (kind === 'link_exchanges') {
    await tx`
      insert into app.guest_counters (property_id, day, link_exchanges) values (${propertyId}, ${day}, 1)
      on conflict (property_id, day) do update set link_exchanges = app.guest_counters.link_exchanges + 1
    `;
    return;
  }
  if (kind === 'guide_opens') {
    await tx`
      insert into app.guest_counters (property_id, day, guide_opens) values (${propertyId}, ${day}, 1)
      on conflict (property_id, day) do update set guide_opens = app.guest_counters.guide_opens + 1
    `;
    return;
  }
  await tx`
    insert into app.guest_counters (property_id, day, submissions) values (${propertyId}, ${day}, 1)
    on conflict (property_id, day) do update set submissions = app.guest_counters.submissions + 1
  `;
}

// Runs in the link context so the counter policies can only ever reach the link's own property.
export async function bumpGuestCounter(input: {
  shareId: string;
  propertyId: string;
  kind: GuestCounterKind;
}): Promise<void> {
  try {
    await withLinkContext(input.shareId, (tx) => upsertCounter(tx, input.propertyId, input.kind));
  } catch {
    logEvent('counter_write_failed', { appEnv, outcome: 'failed' });
  }
}
