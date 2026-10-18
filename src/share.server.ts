import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type postgres from 'postgres';
import { z } from 'zod';
import { canonicalInput } from './canonical-input.server';
import { withLinkContext } from './db.server';
import { serverEnv } from './env.server';
import { readGuestGuide, type GuestGuideDto } from './guide.server';
import { propertyIdInput } from './guide-validation';

// Canonical guest-link layer: host issuance/rotation/disable and the link-scoped guest read.
// Host callers run it inside withOwnerContext, guest callers inside withLinkContext, where RLS
// exposes only the link's own row, its property, and published guest prose.

const GUEST_COOKIE_NAME = 'sw_guest';
export const GUEST_SESSION_SECONDS = 12 * 60 * 60;

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

export type GuestPage = { state: 'guide'; guest: GuestGuideDto } | { state: 'denied' };

const denied = { state: 'denied' } as const;

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
    select id, created_at from app.share_links where property_id = ${parsed.propertyId} and enabled
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
  const existing = await tx`select id from app.share_links where property_id = ${parsed.propertyId} and enabled`;
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
    where property_id = ${parsed.propertyId} and enabled
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

export async function exchangeGuestLink(input: { shareId: string; secret: string }): Promise<string | null> {
  const parsed = canonicalInput(exchangeGuestLinkInput, input);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + GUEST_SESSION_SECONDS * 1000);
  return withLinkContext(parsed.shareId, async (tx) => {
    const [link] = await tx<{ secret_hmac: Buffer | null }[]>`
      select secret_hmac from app.share_links where id = ${parsed.shareId}
    `;
    if (!shareSecretMatches(parsed.secret, link?.secret_hmac ?? null)) return null;
    // POST-side housekeeping keeps the table to this link's live sessions.
    await tx`delete from app.guest_sessions where share_link_id = ${parsed.shareId} and expires_at <= now()`;
    const stored = await tx`
      insert into app.guest_sessions (session_hash, share_link_id, expires_at)
      values (${sessionHash(token)}, ${parsed.shareId}, ${expiresAt})
      returning id
    `;
    return stored.length === 1 ? token : null;
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
  const token = input.sessionToken ? secretSchema.safeParse(input.sessionToken) : null;
  if (!token?.success) return denied;
  return withLinkContext(parsed.shareId, async (tx) => {
    const [link] = await tx<{ property_id: string }[]>`
      select property_id from app.share_links where id = ${parsed.shareId}
    `;
    if (!link) return denied;
    const session = await tx`
      select 1 from app.guest_sessions
      where share_link_id = ${parsed.shareId} and session_hash = ${sessionHash(token.data)} and expires_at > now()
    `;
    if (session.length !== 1) return denied;
    // Capability and session are both live; scope the rest of the read to the link's property.
    await tx`select set_config('app.link_property_id', ${link.property_id}, true)`;
    const guide = await readGuestGuide(tx, link.property_id, parsed.locale ?? null);
    if (!guide?.guidePublished) return denied;
    return { state: 'guide', guest: guide.guest } as const;
  });
}
