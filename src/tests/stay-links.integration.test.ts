// Stay links against the local database only (no dev server): workspace cardinality, session clamp,
// and revocation. Runs inside `bun run test` and skips without the local stack. Synthetic data only.
import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql, withOwnerContext } from '../lib/db.server';
import { readOwnProperties } from '../features/host/host.server';
import { submitGuestMessage } from '../features/messages/messages.server';
import {
  createStayLink,
  exchangeGuestLink,
  insertShareLink,
  newShareLink,
  readGuestPage,
  revokeStayLink,
} from '../features/share/share.server';
import { detectLocalDb, detectLocalStack, localAdmin } from './integration-helpers';

const describeLocal = detectLocalStack() && (await detectLocalDb()) ? describe : describe.skip;
const admin = localAdmin();

afterAll(async () => {
  await admin.end({ timeout: 0 });
  await sql.end({ timeout: 0 });
});

const message = {
  kind: 'question',
  category: 'wifi',
  locale: 'en',
  body: 'Synthetic stay question',
  replyEmail: '',
} as const;

async function fixture() {
  const ownerId = crypto.randomUUID();
  const propertyId = crypto.randomUUID();
  await admin`insert into auth.users (id, email) values (${ownerId}, ${`stay-${ownerId}@example.test`})`;
  await admin`insert into app.properties (id, owner_id, display_name, published) values (${propertyId}, ${ownerId}, 'Stay villa (synthetic)', true)`;
  return { ownerId, propertyId };
}

async function stay(ownerId: string, propertyId: string) {
  const link = newShareLink();
  const today = new Date().toISOString().slice(0, 10);
  const reservationId = await withOwnerContext(ownerId, (tx) =>
    createStayLink(tx, { propertyId, stayStart: today, stayEnd: today, id: link.id, hmac: link.hmac }),
  );
  if (!reservationId) throw new Error('synthetic stay failed');
  return { ...link, reservationId };
}

describeLocal('stay links against the local database', () => {
  it('lists the workspace with a property link, live stays, and an expired stay', async () => {
    const { ownerId, propertyId } = await fixture();
    try {
      const property = newShareLink();
      await withOwnerContext(ownerId, (tx) =>
        insertShareLink(tx, { propertyId, id: property.id, hmac: property.hmac }),
      );
      await stay(ownerId, propertyId);
      const expired = await stay(ownerId, propertyId);
      await admin`update app.share_links set expires_at = now() - interval '1 minute' where id = ${expired.id}`;
      const [row] = await withOwnerContext(ownerId, (tx) => readOwnProperties(tx));
      expect(row).toMatchObject({ id: propertyId, linkOn: true });
    } finally {
      await admin`delete from auth.users where id = ${ownerId}`;
    }
  });

  it('clamps the guest session to the stay link expiry', async () => {
    const { ownerId, propertyId } = await fixture();
    try {
      const link = await stay(ownerId, propertyId);
      const [expiry] = await admin<{ at: Date }[]>`
        update app.share_links set expires_at = date_trunc('second', now()) + interval '1 hour'
        where id = ${link.id} returning expires_at as at
      `;
      expect(await exchangeGuestLink({ shareId: link.id, secret: link.secret })).not.toBeNull();
      const [session] = await admin<{ at: Date }[]>`
        select expires_at as at from app.guest_sessions where share_link_id = ${link.id}
      `;
      expect(session!.at.getTime()).toBe(expiry!.at.getTime());
    } finally {
      await admin`delete from auth.users where id = ${ownerId}`;
    }
  });

  it('revokes one stay: its sessions go and every guest entry denies, other stays keep working', async () => {
    const { ownerId, propertyId } = await fixture();
    try {
      const revoked = await stay(ownerId, propertyId);
      const kept = await stay(ownerId, propertyId);
      const revokedToken = await exchangeGuestLink({ shareId: revoked.id, secret: revoked.secret });
      const keptToken = await exchangeGuestLink({ shareId: kept.id, secret: kept.secret });
      expect(
        await withOwnerContext(ownerId, (tx) =>
          revokeStayLink(tx, { propertyId, reservationId: revoked.reservationId }),
        ),
      ).toBe(true);

      const [sessions] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.guest_sessions where share_link_id = ${revoked.id}
      `;
      expect(sessions!.n).toBe(0);
      expect(await exchangeGuestLink({ shareId: revoked.id, secret: revoked.secret })).toBeNull();
      expect(await readGuestPage({ shareId: revoked.id, sessionToken: revokedToken })).toEqual({ state: 'denied' });
      expect(await submitGuestMessage({ shareId: revoked.id, sessionToken: revokedToken, message })).toEqual({
        state: 'denied',
      });
      expect((await readGuestPage({ shareId: kept.id, sessionToken: keptToken })).state).toBe('guide');
    } finally {
      await admin`delete from auth.users where id = ${ownerId}`;
    }
  });
});
