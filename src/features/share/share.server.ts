import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type postgres from 'postgres';
import { z } from 'zod';
import { canonicalInput } from '../../lib/canonical-input.server';
import { withLinkContext } from '../../lib/db.server';
import { serverEnv } from '../../lib/env.server';
import { bumpGuestCounter, bumpRate, utcWindow } from '../guest/guest-counters.server';
import {
  readGuestGuide,
  readPropertyEssentials,
  type GuestGuideDto,
  type PropertyEssentials,
} from '../guide/guide.server';
import { isGuestLocale } from '../guest/guest-ui';
import { propertyIdInput } from '../guide/guide-validation';

// Canonical guest-link layer: host issuance/rotation/disable and the link-scoped guest read.
// Host callers run it inside withOwnerContext, guest callers inside withLinkContext, where RLS
// exposes only the link's own row, its property, and published guest prose.

const GUEST_COOKIE_NAME = 'sw_guest';
const LANGUAGE_COOKIE_NAME = 'sw_lang';
const LANGUAGE_COOKIE_SECONDS = 180 * 24 * 60 * 60;
export const GUEST_SESSION_SECONDS = 12 * 60 * 60;
export const GUEST_EXCHANGES_PER_HOUR = 30;

const shareIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const secretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const digestSchema = z.instanceof(Buffer).refine((value) => value.length === 32, { message: 'sha256 digest expected' });
const shareLinkInput = z.object({ propertyId: z.uuid(), id: shareIdSchema, hmac: digestSchema });
export const exchangeGuestLinkInput = z.object({ shareId: shareIdSchema, secret: secretSchema });
export const guestPageInput = z.object({ shareId: shareIdSchema, locale: z.string().max(16).optional() });

export type ShareLinkState = {
  link: { id: string; createdAt: string } | null;
  guidePublished: boolean;
};

export type GuestPage =
  | { state: 'guide'; guest: GuestGuideDto & { essentials: PropertyEssentials } }
  | { state: 'denied' }
  | { state: 'error' };

const denied = { state: 'denied' } as const;

// A thrown read is retryable; only a link or session check yields denied.
export function guestFailure(result: Exclude<GuestPage, { state: 'guide' }> | { error: string }, locale: string) {
  return { state: 'state' in result && result.state === 'denied' ? 'denied' : 'error', locale } as const;
}

export function newShareLink(): { id: string; secret: string; hmac: Buffer } {
  const secret = randomBytes(32).toString('base64url');
  return { id: randomBytes(16).toString('base64url'), secret, hmac: secretHmac(secret) };
}

function secretHmac(secret: string): Buffer {
  return createHmac('sha256', serverEnv.shareHmacKey).update(secret).digest();
}

// Fixed-shape digest so an unknown link id costs the same constant-time compare as a real one.
const missingLinkDigest = createHmac('sha256', 'staywise-missing-link').digest();

// Never pass the presented secret or its digest to SQL: fetch the stored HMAC by link id and
// compare in memory, failing closed when the row is invisible, disabled, or already rotated.
export function shareSecretMatches(secret: string, stored: Buffer | null): boolean {
  // Compare before folding in the existence flag, so a missing digest takes the same
  // constant-time path as a known-live row instead of short-circuiting past the compare.
  const matches = timingSafeEqual(secretHmac(secret), stored ?? missingLinkDigest);
  return matches && stored !== null;
}

function sessionHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function guestSessionToken(cookieHeader: string | null): string | null {
  const value = parseCookieHeader(cookieHeader ?? '').find((cookie) => cookie.name === GUEST_COOKIE_NAME)?.value;
  return value && secretSchema.safeParse(value).success ? value : null;
}

// Narrow Path=/g: guest pages are full document loads, so the cookie never needs to travel to
// host routes or server-function endpoints.
export function serializeGuestCookie(token: string, secure: boolean): string {
  return serializeCookieHeader(GUEST_COOKIE_NAME, token, {
    path: '/g',
    sameSite: 'lax',
    httpOnly: true,
    secure,
    maxAge: GUEST_SESSION_SECONDS,
  });
}

export function resolveGuestLocale(query: string | undefined, cookieHeader: string | null) {
  const explicit = query && isGuestLocale(query) ? query : undefined;
  const remembered = parseCookieHeader(cookieHeader ?? '').find(
    (cookie) => cookie.name === LANGUAGE_COOKIE_NAME,
  )?.value;
  return { locale: explicit ?? (remembered && isGuestLocale(remembered) ? remembered : undefined), remember: explicit };
}

export function serializeLanguageCookie(locale: string, secure: boolean): string {
  return serializeCookieHeader(LANGUAGE_COOKIE_NAME, locale, {
    path: '/g',
    sameSite: 'lax',
    httpOnly: true,
    secure,
    maxAge: LANGUAGE_COOKIE_SECONDS,
  });
}

export async function readShareLinkState(
  tx: postgres.TransactionSql,
  propertyId: string,
): Promise<ShareLinkState | null> {
  const parsed = canonicalInput(propertyIdInput, { propertyId });
  const [property] = await tx<{ published: boolean }[]>`
    select published from app.properties where id = ${parsed.propertyId}
  `;
  if (!property) return null;
  const [link] = await tx<{ id: string; created_at: Date }[]>`
    select id, created_at from app.share_links where property_id = ${parsed.propertyId} and enabled and kind = 'property'
  `;
  return {
    link: link ? { id: link.id, createdAt: link.created_at.toISOString() } : null,
    guidePublished: property.published,
  };
}

export async function insertShareLink(
  tx: postgres.TransactionSql,
  input: { propertyId: string; id: string; hmac: Buffer },
): Promise<boolean> {
  const parsed = canonicalInput(shareLinkInput, input);
  // Property row lock: one enabled link per property, serialized against concurrent issuance.
  const locked = await tx`select id from app.properties where id = ${parsed.propertyId} for update`;
  if (locked.length !== 1) return false;
  const existing = await tx`
    select id from app.share_links where property_id = ${parsed.propertyId} and enabled and kind = 'property'
  `;
  if (existing.length > 0) return false;
  const rows = await tx`
    insert into app.share_links (id, secret_hmac, property_id)
    values (${parsed.id}, ${parsed.hmac}, ${parsed.propertyId})
    returning id
  `;
  return rows.length === 1;
}

// Disabling drops the digest and every session of the link, so the old capability and any session
// derived from it stop working at the same commit.
export async function disableShareLink(tx: postgres.TransactionSql, propertyId: string): Promise<string | null> {
  const parsed = canonicalInput(propertyIdInput, { propertyId });
  const locked = await tx`select id from app.properties where id = ${parsed.propertyId} for update`;
  if (locked.length !== 1) return null;
  const [disabled] = await tx<{ id: string }[]>`
    update app.share_links set enabled = false, disabled_at = now(), secret_hmac = null
    where property_id = ${parsed.propertyId} and enabled and kind = 'property'
    returning id
  `;
  if (!disabled) return null;
  await tx`delete from app.guest_sessions where share_link_id = ${disabled.id}`;
  return disabled.id;
}

// Rotation is disable plus a fresh link in one transaction: old sessions die with the old link.
export async function rotateShareLink(
  tx: postgres.TransactionSql,
  input: { propertyId: string; id: string; hmac: Buffer },
): Promise<boolean> {
  // Full replacement validated before the first write: a caller that catches the canonical error
  // must not be able to commit a disabled old link with no replacement.
  const parsed = canonicalInput(shareLinkInput, input);
  const disabled = await disableShareLink(tx, parsed.propertyId);
  if (!disabled) return false;
  return insertShareLink(tx, parsed);
}

export function sessionExpiry(sessionEnd: number, linkExpiresAt: Date | null): Date {
  return new Date(linkExpiresAt ? Math.min(sessionEnd, linkExpiresAt.getTime()) : sessionEnd);
}

const isoDate = z.iso.date();
export const stayLinkInput = z
  .object({ propertyId: z.uuid(), stayStart: isoDate, stayEnd: isoDate })
  .refine((value) => value.stayEnd >= value.stayStart, {
    path: ['stayEnd'],
    message: 'Check-out must be after check-in',
  });
const stayLinkInsert = z.object({ ...stayLinkInput.shape, id: shareIdSchema, hmac: digestSchema });
export const revokeStayLinkInput = z.object({ propertyId: z.uuid(), reservationId: z.uuid() });

export type Stay = { reservationId: string; stayStart: string; stayEnd: string; linkOn: boolean; expiresAt: string };

// shortcut: expires at UTC noon the day after check-out; use the property timezone once one is stored.
export function stayLinkExpiry(stayEnd: string): Date {
  const expiry = new Date(`${stayEnd}T12:00:00Z`);
  expiry.setUTCDate(expiry.getUTCDate() + 1);
  return expiry;
}

export async function createStayLink(
  tx: postgres.TransactionSql,
  input: { propertyId: string; stayStart: string; stayEnd: string; id: string; hmac: Buffer },
): Promise<string | null> {
  const parsed = canonicalInput(stayLinkInsert, input);
  const [reservation] = await tx<{ id: string }[]>`
    insert into app.reservations (property_id, source, external_id, stay_start, stay_end)
    select p.id, 'manual', gen_random_uuid()::text, ${parsed.stayStart}, ${parsed.stayEnd}
    from app.properties p where p.id = ${parsed.propertyId}
    returning id
  `;
  if (!reservation) return null;
  await tx`
    insert into app.share_links (id, secret_hmac, property_id, kind, reservation_id, expires_at)
    values (${parsed.id}, ${parsed.hmac}, ${parsed.propertyId}, 'stay', ${reservation.id}, ${stayLinkExpiry(parsed.stayEnd)})
  `;
  return reservation.id;
}

// Same as disabling the property link: the digest and every session go at the same commit.
export async function revokeStayLink(
  tx: postgres.TransactionSql,
  input: { propertyId: string; reservationId: string },
): Promise<boolean> {
  const parsed = canonicalInput(revokeStayLinkInput, input);
  const [disabled] = await tx<{ id: string }[]>`
    update app.share_links set enabled = false, disabled_at = now(), secret_hmac = null
    where property_id = ${parsed.propertyId} and reservation_id = ${parsed.reservationId} and enabled
    returning id
  `;
  if (!disabled) return false;
  await tx`delete from app.guest_sessions where share_link_id = ${disabled.id}`;
  return true;
}

// Expired stays drop from the list; their reservation rows leave with the reservation retention.
export async function readStays(tx: postgres.TransactionSql, propertyId: string): Promise<Stay[]> {
  const parsed = canonicalInput(propertyIdInput, { propertyId });
  const rows = await tx<{ id: string; stay_start: string; stay_end: string; link_on: boolean; expires_at: Date }[]>`
    select r.id, r.stay_start::text, r.stay_end::text, bool_or(l.enabled) as link_on, max(l.expires_at) as expires_at
    from app.reservations r join app.share_links l on l.reservation_id = r.id
    where r.property_id = ${parsed.propertyId} and l.kind = 'stay' and l.expires_at > now()
    group by r.id
    order by r.stay_start, r.id
  `;
  return rows.map((row) => ({
    reservationId: row.id,
    stayStart: row.stay_start,
    stayEnd: row.stay_end,
    linkOn: row.link_on,
    expiresAt: row.expires_at.toISOString(),
  }));
}

export async function exchangeGuestLink(input: { shareId: string; secret: string }): Promise<string | null> {
  const parsed = canonicalInput(exchangeGuestLinkInput, input);
  if (serverEnv.guestAccessDisabled) return null;
  const token = randomBytes(32).toString('base64url');
  const sessionEnd = Date.now() + GUEST_SESSION_SECONDS * 1000;
  const exchanged = await withLinkContext(parsed.shareId, async (tx) => {
    const [link] = await tx<{ secret_hmac: Buffer | null; property_id: string; expires_at: Date | null }[]>`
      select secret_hmac, property_id, expires_at from app.share_links where id = ${parsed.shareId}
    `;
    if (!link || !shareSecretMatches(parsed.secret, link.secret_hmac)) return null;
    // Counted only after the secret matches, so knowing the share id alone cannot lock guests out.
    const exchangeKey = createHmac('sha256', serverEnv.shareHmacKey)
      .update(`guest-exchange:${parsed.shareId}`)
      .digest();
    if ((await bumpRate(tx, link.property_id, exchangeKey, utcWindow(3600))) > GUEST_EXCHANGES_PER_HOUR) return null;
    // POST-side housekeeping keeps the table to this link's live sessions.
    await tx`delete from app.guest_sessions where share_link_id = ${parsed.shareId} and expires_at <= now()`;
    const stored = await tx`
      insert into app.guest_sessions (session_hash, share_link_id, expires_at)
      values (${sessionHash(token)}, ${parsed.shareId}, ${sessionExpiry(sessionEnd, link.expires_at)})
      returning id
    `;
    return stored.length === 1 ? { token, propertyId: link.property_id } : null;
  });
  if (!exchanged) return null;
  // A successful exchange counts once; the bump is best-effort and cannot change the session.
  await bumpGuestCounter({ shareId: parsed.shareId, propertyId: exchanged.propertyId, kind: 'link_exchanges' });
  return exchanged.token;
}

export type ActiveGuestLink = { propertyId: string; sessionToken: string };

// Shared guest validation for reads and message intake: the presented session must match a live
// session of the still-enabled link, and the link's property must still be published. Every
// failure is one uniform null so callers cannot tell the cases apart.
export async function withActiveGuestLink<T>(
  input: { shareId: string; sessionToken: string | null },
  work: (tx: postgres.TransactionSql, link: ActiveGuestLink) => Promise<T>,
): Promise<T | null> {
  const parsed = guestPageInput.pick({ shareId: true }).safeParse({ shareId: input.shareId });
  if (!parsed.success) return null;
  const token = input.sessionToken ? secretSchema.safeParse(input.sessionToken) : null;
  if (!token?.success) return null;
  if (serverEnv.guestAccessDisabled) return null;
  return withLinkContext(parsed.data.shareId, async (tx) => {
    const [link] = await tx<{ property_id: string }[]>`
      select property_id from app.share_links where id = ${parsed.data.shareId}
    `;
    if (!link) return null;
    const session = await tx`
      select 1 from app.guest_sessions
      where share_link_id = ${parsed.data.shareId} and session_hash = ${sessionHash(token.data)} and expires_at > now()
    `;
    if (session.length !== 1) return null;
    // Capability and session are both live; scope the rest of the request to the link's property.
    await tx`select set_config('app.link_property_id', ${link.property_id}, true)`;
    const [property] = await tx<{ published: boolean }[]>`
      select published from app.properties where id = ${link.property_id}
    `;
    if (!property?.published) return null;
    return work(tx, { propertyId: link.property_id, sessionToken: token.data });
  });
}

// Every guest read revalidates the session against the still-enabled link in one transaction; a
// disabled or rotated link denies uniformly, even for a session captured while it was live.
export async function readGuestPage(input: {
  shareId: string;
  sessionToken: string | null;
  locale?: string;
}): Promise<GuestPage> {
  const parsed = canonicalInput(guestPageInput, { shareId: input.shareId, locale: input.locale });
  const read = await withActiveGuestLink(
    { shareId: parsed.shareId, sessionToken: input.sessionToken },
    async (tx, link) => {
      const guide = await readGuestGuide(tx, link.propertyId, parsed.locale ?? null);
      if (!guide) return null;
      // Credentials join in only here, after the session check, under the link-scoped RLS policy.
      const essentials = await readPropertyEssentials(tx, link.propertyId);
      return { propertyId: link.propertyId, guest: { ...guide.guest, essentials } };
    },
  );
  if (!read) return denied;
  // A successful read counts once; the bump is best-effort and cannot change the response.
  await bumpGuestCounter({ shareId: parsed.shareId, propertyId: read.propertyId, kind: 'guide_opens' });
  return { state: 'guide', guest: read.guest } as const;
}
