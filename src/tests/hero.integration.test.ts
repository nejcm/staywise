// Hero image routes against the real local stack, Storage, and dev server: upload, owner and guest
// reads, replace and remove drain, and uniform guest denial. Skips without them; synthetic data only.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { reserveHeroUpload, upsertHero } from '../features/guide/guide.server';
import { sql, withOwnerContext } from '../lib/db.server';
import { serverEnv } from '../lib/env.server';
import {
  createStayLink,
  exchangeGuestLink,
  insertShareLink,
  newShareLink,
  revokeStayLink,
  rotateShareLink,
} from '../features/share/share.server';
import {
  APP,
  GUIDE_FNS,
  decode,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  fnCall,
  localAdmin,
  verifiedHost,
  type LocalStack,
  type VerifiedHost,
} from './integration-helpers';

const localStack = detectLocalStack();
const describeLocal = localStack && (await detectLocalDb()) && (await detectDevServer()) ? describe : describe.skip;
const admin = localAdmin();
const jpeg = readFileSync(new URL('./fixtures/synthetic-hero.jpg', import.meta.url));

afterAll(async () => {
  await admin.end({ timeout: 0 });
  await sql.end({ timeout: 0 });
});

const guideFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(GUIDE_FNS, name, options);

function upload(propertyId: string, cookie: string | undefined, alt = 'Lake view (synthetic)') {
  return fetch(`${APP}/host/properties/${propertyId}/hero`, {
    method: 'POST',
    headers: {
      origin: APP,
      'content-type': 'image/jpeg',
      'x-hero-alt': encodeURIComponent(alt),
      ...(cookie ? { cookie } : {}),
    },
    body: jpeg,
  });
}

const hostHero = (propertyId: string, cookie: string) =>
  fetch(`${APP}/host/properties/${propertyId}/hero`, { headers: { cookie } });
const guestHero = (shareId: string, token: string) =>
  fetch(`${APP}/g/${shareId}/hero?v=1`, { headers: { cookie: `sw_guest=${token}` } });

async function guestToken(ownerId: string, propertyId: string, kind: 'property' | 'stay') {
  const link = newShareLink();
  const today = new Date().toISOString().slice(0, 10);
  const reservationId = await withOwnerContext(ownerId, async (tx) => {
    if (kind === 'stay') return createStayLink(tx, { propertyId, stayStart: today, stayEnd: today, ...link });
    await insertShareLink(tx, { propertyId, ...link });
    return null;
  });
  const token = await exchangeGuestLink({ shareId: link.id, secret: link.secret });
  if (!token) throw new Error('synthetic exchange failed');
  return { ...link, token, reservationId };
}

async function drainWaitsOnLock(): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await admin`
      select 1 from pg_stat_activity
      where wait_event_type = 'Lock' and query like '%delete from app.storage_deletions where object_path in%'
    `;
    if (rows.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function storedObjects(propertyId: string) {
  const [row] = await admin<{ objects: number; queued: number }[]>`
    select
      (select count(*)::int from storage.objects where bucket_id = 'guide-images' and name like ${`${propertyId}/%`}) as objects,
      (select count(*)::int from app.storage_deletions where object_path like ${`${propertyId}/%`}) as queued
  `;
  return row;
}

describeLocal('hero image routes against the local stack', () => {
  it('uploads, serves, replaces, and removes a hero, denying guests whose access ended', async (ctx) => {
    const local = localStack as LocalStack;
    const host: VerifiedHost = await verifiedHost(local, 'hero');
    const other: VerifiedHost = await verifiedHost(local, 'hero-other');
    const propertyId = crypto.randomUUID();
    await admin`insert into app.properties (id, owner_id, display_name, published) values (${propertyId}, ${host.userId}, 'Hero villa (synthetic)', true)`;
    try {
      const editor = decode<{ heroUpload?: boolean }>(
        await guideFn('getPropertyEditor', { jar: host.jar, data: { propertyId } }),
      )?.result;
      // The dev server only stores images when it was started with SUPABASE_SECRET_KEY.
      if (!editor?.heroUpload) ctx.skip();

      // A real AAL2 session in a raw handler proves aal2Host reads the request through getRequest().
      const first = await upload(propertyId, host.jar.header());
      expect(first.status).toBe(200);
      expect((await first.json()).hero).toMatchObject({ alt: 'Lake view (synthetic)', width: 24, height: 16 });
      expect((await upload(propertyId, other.jar.header())).status).toBe(403);
      expect((await upload(propertyId, undefined)).status).toBe(403);

      const owned = await hostHero(propertyId, host.jar.header());
      expect(owned.status).toBe(200);
      expect(Buffer.from(await owned.arrayBuffer())).toEqual(jpeg);
      expect((await hostHero(propertyId, other.jar.header())).status).toBe(404);

      const property = await guestToken(host.userId, propertyId, 'property');
      const served = await guestHero(property.id, property.token);
      expect(served.status).toBe(200);
      expect(served.headers.get('cache-control')).toBe('private, no-store');
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await served.arrayBuffer())).toEqual(jpeg);

      expect((await upload(propertyId, host.jar.header(), 'Lake at dusk (synthetic)')).status).toBe(200);
      expect(await storedObjects(propertyId)).toEqual({ objects: 1, queued: 0 });

      await admin`update app.properties set published = false where id = ${propertyId}`;
      expect((await guestHero(property.id, property.token)).status).toBe(404);
      await admin`update app.properties set published = true where id = ${propertyId}`;
      expect((await guestHero(property.id, property.token)).status).toBe(200);

      const revoked = await guestToken(host.userId, propertyId, 'stay');
      expect((await guestHero(revoked.id, revoked.token)).status).toBe(200);
      await withOwnerContext(host.userId, (tx) =>
        revokeStayLink(tx, { propertyId, reservationId: revoked.reservationId ?? '' }),
      );
      expect((await guestHero(revoked.id, revoked.token)).status).toBe(404);

      const expired = await guestToken(host.userId, propertyId, 'stay');
      await admin`update app.guest_sessions set expires_at = now() - interval '1 second' where share_link_id = ${expired.id}`;
      expect((await guestHero(expired.id, expired.token)).status).toBe(404);

      const rotated = newShareLink();
      await withOwnerContext(host.userId, (tx) => rotateShareLink(tx, { propertyId, ...rotated }));
      expect((await guestHero(property.id, property.token)).status).toBe(404);

      const altSaved = await guideFn('saveHeroAlt', {
        jar: host.jar,
        data: { propertyId, alt: 'Lake and pier (synthetic)' },
      });
      expect(decode<{ ok?: boolean }>(altSaved)?.result?.ok).toBe(true);
      const foreignAlt = await guideFn('saveHeroAlt', { jar: other.jar, data: { propertyId, alt: 'Taken' } });
      expect(decode<{ error?: string }>(foreignAlt)?.result?.error).toBe('invalid_input');

      const removed = await guideFn('removeHero', { jar: host.jar, data: { propertyId } });
      expect(decode<{ ok?: boolean }>(removed)?.result?.ok).toBe(true);
      expect(await storedObjects(propertyId)).toEqual({ objects: 0, queued: 0 });
      expect((await hostHero(propertyId, host.jar.header())).status).toBe(404);

      expect((await upload(propertyId, host.jar.header())).status).toBe(200);
      const deleted = await guideFn('deleteProperty', { jar: host.jar, data: { propertyId } });
      expect(decode<{ ok?: boolean }>(deleted)?.result?.ok).toBe(true);
      expect(await storedObjects(propertyId)).toEqual({ objects: 0, queued: 0 });
    } finally {
      await admin`delete from app.properties where id = ${propertyId}`;
      await admin`delete from app.storage_deletions where object_path like ${`${propertyId}/%`}`;
    }
  });

  async function storageModule(ctx: { skip: () => void }) {
    const secretKey = (localStack as LocalStack).secretKey;
    if (!secretKey.startsWith('sb_secret_')) ctx.skip();
    // The test process has no .env; the Storage client reads the key when the module loads.
    serverEnv.supabaseSecretKey = secretKey;
    return import('../lib/storage.server');
  }

  async function withOwnedProperty(work: (ownerId: string, propertyId: string) => Promise<void>) {
    const { drainStorageDeletions } = await import('../lib/storage.server');
    const ownerId = crypto.randomUUID();
    const propertyId = crypto.randomUUID();
    await admin`insert into auth.users (id, email) values (${ownerId}, ${`hero-race-${ownerId}@example.test`})`;
    await admin`insert into app.properties (id, owner_id, display_name) values (${propertyId}, ${ownerId}, 'Race villa (synthetic)')`;
    try {
      await work(ownerId, propertyId);
    } finally {
      await admin`delete from auth.users where id = ${ownerId}`;
      await admin`update app.storage_deletions set not_before = now() where object_path like ${`${propertyId}/%`}`;
      await drainStorageDeletions();
      expect(await storedObjects(propertyId)).toEqual({ objects: 0, queued: 0 });
    }
  }

  const input = (propertyId: string) => ({
    propertyId,
    alt: 'Race (synthetic)',
    width: 24,
    height: 16,
    bytes: jpeg.byteLength,
  });

  it('refuses to publish a due reservation and drains one whose bytes never arrived', async (ctx) => {
    const { drainStorageDeletions } = await storageModule(ctx);
    await withOwnedProperty(async (ownerId, propertyId) => {
      const objectPath = await withOwnerContext(ownerId, (tx) => reserveHeroUpload(tx, propertyId));
      if (!objectPath) throw new Error('synthetic reservation failed');
      // Stands in for a drain that removed the bytes and then rolled back, leaving the row due again.
      await admin`update app.storage_deletions set not_before = now() - interval '1 second' where object_path = ${objectPath}`;
      await expect(withOwnerContext(ownerId, (tx) => upsertHero(tx, objectPath, input(propertyId)))).rejects.toThrow(
        'upload_reservation_expired',
      );
      expect(await storedObjects(propertyId)).toEqual({ objects: 0, queued: 1 });
      expect(await drainStorageDeletions()).toBeGreaterThan(0);
      expect(await storedObjects(propertyId)).toEqual({ objects: 0, queued: 0 });
    });
  });

  it('makes a drain wait for a publish that claimed its reservation, then keeps the bytes', async (ctx) => {
    const { drainStorageDeletions, putImage } = await storageModule(ctx);
    await withOwnedProperty(async (ownerId, propertyId) => {
      const objectPath = await withOwnerContext(ownerId, (tx) => reserveHeroUpload(tx, propertyId));
      if (!objectPath) throw new Error('synthetic reservation failed');
      expect(await putImage(objectPath, jpeg)).toBe(true);
      const [lease] = await admin<{ due: Date }[]>`
        update app.storage_deletions set not_before = clock_timestamp() + interval '1 second'
        where object_path = ${objectPath} returning not_before as due
      `;

      let claimed = () => {};
      let release = () => {};
      const claimedSignal = new Promise<void>((resolve) => (claimed = resolve));
      const releaseSignal = new Promise<void>((resolve) => (release = resolve));
      const publish = withOwnerContext(ownerId, async (tx) => {
        const hero = await upsertHero(tx, objectPath, input(propertyId));
        claimed();
        await releaseSignal;
        return hero;
      });
      let drain: Promise<number> | undefined;
      try {
        await Promise.race([claimedSignal, publish]);
        // The claimed row becomes due while the publish is still open, which is when a drain could take it.
        while (
          (await admin<{ due: boolean }[]>`select clock_timestamp() > ${lease?.due ?? new Date()} as due`)[0]?.due !==
          true
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        drain = drainStorageDeletions();
        expect(await drainWaitsOnLock()).toBe(true);
      } finally {
        release();
        await Promise.allSettled([publish, drain]);
      }
      expect(await publish).not.toBeNull();
      expect(await storedObjects(propertyId)).toEqual({ objects: 1, queued: 0 });
    });
  });
});
