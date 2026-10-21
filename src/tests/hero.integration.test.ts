// Hero image routes against the real local stack, Storage, and dev server: upload, owner and guest
// reads, replace and remove drain, and uniform guest denial. Skips without them; synthetic data only.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { sql, withOwnerContext } from '../lib/db.server';
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
    } finally {
      await admin`delete from app.properties where id = ${propertyId}`;
      await admin`delete from app.storage_deletions where object_path like ${`${propertyId}/%`}`;
    }
  });
});
