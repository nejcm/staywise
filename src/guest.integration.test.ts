// Phase 4 guest-link trust boundaries against the real local stack and dev server: fragment-secret
// exchange, HttpOnly guest sessions, revocation on disable/rotation, and uniform denial.
// Requires `bun run db:start` and `bun run dev`; runs inside `bun run test` and skips without them.
// Run directly with: bun run test:local (synthetic data only; never a remote environment).
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { sql, withOwnerContext } from './db.server';
import {
  adminClient,
  decode,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  fnCall,
  localAdmin,
  memoryJar,
  quoteLiteral,
  verifiedHost,
  type Jar,
  type LocalStack,
  type VerifiedHost,
} from './integration-helpers';
import {
  disableShareLink as disableShareLinkRow,
  exchangeGuestLink,
  insertShareLink,
  readShareLinkState,
  rotateShareLink,
  type GuestPage,
} from './share.server';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp ? describe : describe.skip;

const APP = 'http://localhost:3000';
const GUIDE_FNS = '/src/guide-fns.ts?tss-serverfn-split';
const SHARE_FNS = '/src/share-fns.ts?tss-serverfn-split';
const GUEST_FNS = '/src/guest-fns.ts?tss-serverfn-split';

const PUBLISHED_BODY = 'SYNTHETIC-PUBLISHED-BODY-OK';
const DRAFT_BODY = 'SYNTHETIC-DRAFT-BODY-NEVER';
const NOTE_BODY = 'SYNTHETIC-NOTE-BODY-NEVER';
const SECRET_VALUE = 'SYNTHETIC-SECRET-NEVER';
const GUEST_COOKIE = 'sw_guest=';

type ShareLink = { shareId: string; secret: string };
type GuestSession = { link: ShareLink; guestCookie: string; guestToken: string };

function devServerLog(): string | null {
  const path = fileURLToPath(new URL('../.git/orchestration/dev-server.log', import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// The SSR denial is the same opening shell whether the link is unknown, disabled, rotated, or the
// request has no session yet; the browser then shows one denial message for every case.
const deniedShell = (html: string) => html.includes('Opening your guide');

afterAll(async () => {
  await sql.end({ timeout: 0 });
});

const guideFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(GUIDE_FNS, name, options);
const shareFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(SHARE_FNS, name, options);
const guestFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(GUEST_FNS, name, options);

async function createProperty(host: VerifiedHost): Promise<string> {
  const created = decode<{ propertyId: string }>(
    await guideFn('createProperty', {
      jar: host.jar,
      data: { displayName: 'Guest integration villa (synthetic)', sourceLocale: 'en' },
    }),
  )?.result;
  if (!created?.propertyId) throw new Error('synthetic property creation failed');
  return created.propertyId;
}

async function createSection(host: VerifiedHost, propertyId: string, category: string): Promise<string> {
  const created = decode<{ sectionId: string }>(
    await guideFn('createSection', { jar: host.jar, data: { propertyId, category } }),
  )?.result;
  if (!created?.sectionId) throw new Error('synthetic section creation failed');
  return created.sectionId;
}

async function saveSection(host: VerifiedHost, data: Record<string, unknown>) {
  const saved = decode<{ ok?: boolean }>(await guideFn('saveSection', { jar: host.jar, data }))?.result;
  if (!saved?.ok) throw new Error('synthetic section save failed');
}

// One published guest section plus a draft and a host note that must never reach a guest.
async function publishedGuide(): Promise<{ host: VerifiedHost; propertyId: string }> {
  const local = localStack as LocalStack;
  const host = await verifiedHost(local, 'guest');
  const propertyId = await createProperty(host);
  const wifi = await createSection(host, propertyId, 'wifi');
  await saveSection(host, {
    propertyId,
    sectionId: wifi,
    category: 'wifi',
    title: 'Guest Wi-Fi',
    body: PUBLISHED_BODY,
    visibility: 'guest',
    secretValue: '',
    published: true,
  });
  const draft = await createSection(host, propertyId, 'rules');
  await saveSection(host, {
    propertyId,
    sectionId: draft,
    category: 'rules',
    title: 'Synthetic draft',
    body: DRAFT_BODY,
    visibility: 'guest',
    secretValue: '',
    published: false,
  });
  const note = await createSection(host, propertyId, 'emergency');
  await saveSection(host, {
    propertyId,
    sectionId: note,
    category: 'emergency',
    title: 'Host note',
    body: NOTE_BODY,
    visibility: 'host',
    secretValue: SECRET_VALUE,
    published: true,
  });
  const published = decode<{ ok?: boolean }>(
    await guideFn('setGuidePublished', { jar: host.jar, data: { propertyId, published: true } }),
  )?.result;
  if (!published?.ok) throw new Error('synthetic publish failed');
  return { host, propertyId };
}

async function createLink(host: VerifiedHost, propertyId: string): Promise<ShareLink> {
  const issued = decode<{ shareId?: string; secret?: string }>(
    await shareFn('createGuestLink', { jar: host.jar, data: { propertyId } }),
  )?.result;
  if (!issued?.shareId || !issued.secret) throw new Error('synthetic link issuance failed');
  return { shareId: issued.shareId, secret: issued.secret };
}

async function rotateLink(host: VerifiedHost, propertyId: string): Promise<ShareLink> {
  const issued = decode<{ shareId?: string; secret?: string }>(
    await shareFn('rotateGuestLink', { jar: host.jar, data: { propertyId } }),
  )?.result;
  if (!issued?.shareId || !issued.secret) throw new Error('synthetic link rotation failed');
  return { shareId: issued.shareId, secret: issued.secret };
}

function jarFor(pair: string): Jar {
  const jar = memoryJar();
  const separator = pair.indexOf('=');
  jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  return jar;
}

async function exchange(shareId: string, secret: unknown, origin = APP, contentType = 'application/json') {
  const response = await fetch(`${APP}/g/${shareId}/exchange`, {
    method: 'POST',
    headers: { origin, 'content-type': contentType },
    body: JSON.stringify({ secret }),
    redirect: 'manual',
  });
  return {
    status: response.status,
    body: await response.text(),
    cacheControl: response.headers.get('cache-control'),
    setCookies: response.headers.getSetCookie(),
  };
}

async function sessionFor(link: ShareLink): Promise<GuestSession> {
  const exchanged = await exchange(link.shareId, link.secret);
  const guestCookie = exchanged.setCookies.find((value) => value.startsWith(GUEST_COOKIE))?.split(';')[0] ?? null;
  if (exchanged.status !== 200 || !guestCookie) throw new Error('synthetic exchange failed');
  return { link, guestCookie, guestToken: guestCookie.slice(GUEST_COOKIE.length) };
}

async function document(shareId: string, guestCookie?: string) {
  const response = await fetch(`${APP}/g/${shareId}`, {
    headers: guestCookie ? { cookie: guestCookie } : {},
    redirect: 'manual',
  });
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    html: await response.text(),
  };
}

async function countLinks(admin: ReturnType<typeof localAdmin>, propertyId: string): Promise<number> {
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from app.share_links where property_id = ${propertyId}
  `;
  return row?.n ?? -1;
}

async function countLinkAudits(admin: ReturnType<typeof localAdmin>, userId: string): Promise<number> {
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from app.audit_events
    where actor_id = ${userId} and action in ('link_created', 'link_disabled')
  `;
  return row?.n ?? -1;
}

describeLocal('guest link trust boundaries against the local stack', () => {
  it('exchanges the fragment secret for a bounded session that reads only published guest prose', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedGuide();
    try {
      const link = await createLink(host, propertyId);
      const exchanged = await exchange(link.shareId, link.secret);
      expect(exchanged.status).toBe(200);
      expect(exchanged.cacheControl).toBe('private, no-store');
      const setCookie = exchanged.setCookies.find((value) => value.startsWith(GUEST_COOKIE)) ?? '';
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/g');
      expect(setCookie).toContain('Max-Age=43200');
      expect(setCookie).not.toContain('Secure');
      const guestCookie = setCookie.split(';')[0] ?? '';
      const guestToken = guestCookie.slice(GUEST_COOKIE.length);
      expect(guestToken).toHaveLength(43);

      const page = await document(link.shareId, guestCookie);
      expect(page.status).toBe(200);
      expect(page.cacheControl).toBe('private, no-store');
      expect(page.html).toContain('Guest integration villa (synthetic)');
      expect(page.html).toContain(PUBLISHED_BODY);
      expect(page.html).not.toContain(DRAFT_BODY);
      expect(page.html).not.toContain(NOTE_BODY);
      expect(page.html).not.toContain(SECRET_VALUE);
      expect(page.html).not.toContain(link.secret);
      expect(page.html).not.toContain(guestToken);

      const read = decode<GuestPage>(
        await guestFn('getGuestPage', { data: { shareId: link.shareId }, jar: jarFor(guestCookie) }),
      );
      expect(read?.result?.state).toBe('guide');
      const sections = read?.result?.state === 'guide' ? read.result.guest.sections : [];
      expect(sections.map((section) => section.title)).toEqual(['Guest Wi-Fi']);
      expect(sections[0]?.body).toBe(PUBLISHED_BODY);

      const anonymous = decode<GuestPage>(await guestFn('getGuestPage', { data: { shareId: link.shareId } }));
      expect(anonymous?.result?.state).toBe('denied');
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 90_000);

  it('denies unknown, wrong, disabled, rotated, and malformed exchanges identically', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedGuide();
    const logBefore = devServerLog()?.length ?? 0;
    try {
      const link = await createLink(host, propertyId);
      const live = await exchange(link.shareId, link.secret);
      expect(live.status).toBe(200);

      const replies = [
        await exchange(link.shareId, crypto.randomBytes(32).toString('base64url')),
        await exchange('b'.repeat(22), crypto.randomBytes(32).toString('base64url')),
        await exchange(link.shareId, 'short'),
        await exchange(link.shareId, undefined),
        await exchange(link.shareId, 'x'.repeat(4000)),
        await exchange(link.shareId, link.secret, 'https://attacker.example'),
        await exchange(link.shareId, link.secret, APP, 'text/plain'),
      ];

      await shareFn('disableGuestLink', { jar: host.jar, data: { propertyId } });
      replies.push(await exchange(link.shareId, link.secret));
      const rotated = await createLink(host, propertyId);
      const replacement = await rotateLink(host, propertyId);
      expect(replacement.shareId).not.toBe(rotated.shareId);
      replies.push(await exchange(rotated.shareId, rotated.secret));

      for (const reply of replies) expect(reply.status).toBe(403);
      expect(new Set(replies.map((reply) => reply.body)).size).toBe(1);
      expect(replies[0]?.cacheControl).toBe('private, no-store');

      const logSlice = devServerLog()?.slice(logBefore) ?? null;
      if (logSlice !== null) {
        expect(logSlice).not.toContain(link.secret);
        expect(logSlice).not.toContain(rotated.secret);
        expect(logSlice).not.toContain(replacement.secret);
      }
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 90_000);

  it('revokes a captured session on rotation and on disable', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedGuide();
    try {
      const first = await sessionFor(await createLink(host, propertyId));
      expect((await document(first.link.shareId, first.guestCookie)).html).toContain(PUBLISHED_BODY);

      const rotated = await rotateLink(host, propertyId);
      expect((await exchange(first.link.shareId, first.link.secret)).status).toBe(403);
      const stale = await document(first.link.shareId, first.guestCookie);
      expect(stale.status).toBe(200);
      expect(stale.html).not.toContain(PUBLISHED_BODY);
      expect(deniedShell(stale.html)).toBe(true);
      const staleRead = decode<GuestPage>(
        await guestFn('getGuestPage', { data: { shareId: first.link.shareId }, jar: jarFor(first.guestCookie) }),
      );
      expect(staleRead?.result?.state).toBe('denied');

      const fresh = await sessionFor(rotated);
      expect((await document(fresh.link.shareId, fresh.guestCookie)).html).toContain(PUBLISHED_BODY);

      const third = await sessionFor(await rotateLink(host, propertyId));
      expect((await document(third.link.shareId, third.guestCookie)).html).toContain(PUBLISHED_BODY);
      await shareFn('disableGuestLink', { jar: host.jar, data: { propertyId } });
      expect((await exchange(third.link.shareId, third.link.secret)).status).toBe(403);
      const revoked = await document(third.link.shareId, third.guestCookie);
      expect(revoked.html).not.toContain(PUBLISHED_BODY);
      expect(deniedShell(revoked.html)).toBe(true);
      expect(revoked.html).not.toContain(third.guestToken);
      expect(revoked.html).not.toContain(third.link.secret);
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 90_000);

  it('hides an unpublished guide from a live session and restores it on publish', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedGuide();
    try {
      const session = await sessionFor(await createLink(host, propertyId));
      expect((await document(session.link.shareId, session.guestCookie)).html).toContain(PUBLISHED_BODY);

      await guideFn('setGuidePublished', { jar: host.jar, data: { propertyId, published: false } });
      const hidden = await document(session.link.shareId, session.guestCookie);
      expect(hidden.html).not.toContain(PUBLISHED_BODY);
      expect(deniedShell(hidden.html)).toBe(true);

      await guideFn('setGuidePublished', { jar: host.jar, data: { propertyId, published: true } });
      expect((await document(session.link.shareId, session.guestCookie)).html).toContain(PUBLISHED_BODY);
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 90_000);

  it('keeps guest reads read-only, session-scoped, and closed to expired sessions', async () => {
    const local = localStack as LocalStack;
    const first = await publishedGuide();
    const second = await publishedGuide();
    const admin = localAdmin();
    try {
      const session = await sessionFor(await createLink(first.host, first.propertyId));
      // Scoped to this link and host: counts of global rows would race other test files running in
      // parallel, but these four values must not move at all across guest reads.
      const snapshot = () =>
        admin<{ last_seen: string | null; expires: string | null; sessions: number; audits: number }[]>`
          select
            (select last_seen_at::text from app.guest_sessions where share_link_id = ${session.link.shareId}) as last_seen,
            (select expires_at::text from app.guest_sessions where share_link_id = ${session.link.shareId}) as expires,
            (select count(*)::int from app.guest_sessions where share_link_id = ${session.link.shareId}) as sessions,
            (select count(*)::int from app.audit_events where actor_id = ${first.host.userId}) as audits
        `;
      const before = (await snapshot())[0];
      expect(before?.last_seen).toEqual(expect.any(String));
      expect(before?.expires).toEqual(expect.any(String));
      expect(before?.sessions).toBe(1);
      expect(before?.audits).toBeGreaterThan(0);
      expect((await document(session.link.shareId, session.guestCookie)).html).toContain(PUBLISHED_BODY);
      await guestFn('getGuestPage', { data: { shareId: session.link.shareId }, jar: jarFor(session.guestCookie) });
      expect((await snapshot())[0]).toEqual(before);

      const foreignLink = await createLink(second.host, second.propertyId);
      const foreignRead = decode<GuestPage>(
        await guestFn('getGuestPage', { data: { shareId: foreignLink.shareId }, jar: jarFor(session.guestCookie) }),
      );
      expect(foreignRead?.result?.state).toBe('denied');
      const foreignDocument = await document(foreignLink.shareId, session.guestCookie);
      expect(foreignDocument.html).not.toContain(PUBLISHED_BODY);
      expect(deniedShell(foreignDocument.html)).toBe(true);

      await admin`
        update app.guest_sessions set expires_at = now() - interval '1 second'
        where share_link_id = ${session.link.shareId}
      `;
      expect(deniedShell((await document(session.link.shareId, session.guestCookie)).html)).toBe(true);
      const expired = decode<GuestPage>(
        await guestFn('getGuestPage', { data: { shareId: session.link.shareId }, jar: jarFor(session.guestCookie) }),
      );
      expect(expired?.result?.state).toBe('denied');
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(first.host.userId);
      await adminClient(local).deleteUser(second.host.userId);
    }
  }, 120_000);

  it('commits link changes only with their audit row and rejects malformed link input canonically', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedGuide();
    const marker = 'SYNTHETIC-PHASE4-AUDIT-FAILURE';
    const admin = localAdmin();
    try {
      await admin.unsafe(`
        create or replace function app.phase4_reject_link_audit() returns trigger language plpgsql as $$
        begin
          if new.actor_id = ${quoteLiteral(host.userId)}::uuid and new.action in ('link_created', 'link_disabled') then
            raise exception ${quoteLiteral(marker)};
          end if;
          return new;
        end $$;
        drop trigger if exists phase4_reject_link_audit on app.audit_events;
        create trigger phase4_reject_link_audit before insert on app.audit_events
          for each row execute function app.phase4_reject_link_audit();
      `);

      const blocked = await shareFn('createGuestLink', { jar: host.jar, data: { propertyId } });
      expect(decode<{ error?: string }>(blocked)?.result?.error).toBe('unexpected');
      expect(blocked.body).not.toContain(marker);
      expect(await countLinks(admin, propertyId)).toBe(0);
      expect(await countLinkAudits(admin, host.userId)).toBe(0);

      await admin.unsafe('drop trigger if exists phase4_reject_link_audit on app.audit_events');
      const session = await sessionFor(await createLink(host, propertyId));
      await admin.unsafe(`
        create trigger phase4_reject_link_audit before insert on app.audit_events
          for each row execute function app.phase4_reject_link_audit();
      `);
      const refused = await shareFn('disableGuestLink', { jar: host.jar, data: { propertyId } });
      expect(decode<{ error?: string }>(refused)?.result?.error).toBe('unexpected');
      const [row] = await admin<{ enabled: boolean; digest: boolean; sessions: number }[]>`
        select l.enabled, l.secret_hmac is not null as digest,
          (select count(*)::int from app.guest_sessions s where s.share_link_id = l.id) as sessions
        from app.share_links l where l.id = ${session.link.shareId}
      `;
      expect(row).toEqual({ enabled: true, digest: true, sessions: 1 });
      expect((await document(session.link.shareId, session.guestCookie)).html).toContain(PUBLISHED_BODY);

      await admin.unsafe('drop trigger if exists phase4_reject_link_audit on app.audit_events');
      await expect(exchangeGuestLink({ shareId: 'x', secret: 'y' })).rejects.toThrow('invalid_input');
      await withOwnerContext(host.userId, async (tx) => {
        await expect(insertShareLink(tx, { propertyId, id: 'short', hmac: Buffer.alloc(4) })).rejects.toThrow(
          'invalid_input',
        );
        await expect(disableShareLinkRow(tx, 'not-a-uuid')).rejects.toThrow('invalid_input');
        await expect(readShareLinkState(tx, 'not-a-uuid')).rejects.toThrow('invalid_input');
        const state = await readShareLinkState(tx, propertyId);
        expect(state?.link?.id).toBe(session.link.shareId);
      });
      const invalidFn = await shareFn('getGuestLink', { jar: host.jar, data: { propertyId: 'not-a-uuid' } });
      expect(decode<{ error?: string }>(invalidFn)?.result?.error).toBe('invalid_input');
      const malformedRead = await guestFn('getGuestPage', { data: { shareId: 'too-short' } });
      expect(decode<GuestPage>(malformedRead)?.result?.state).toBe('denied');
      expect(await countLinks(admin, propertyId)).toBe(1);
      expect(await countLinkAudits(admin, host.userId)).toBe(1);
    } finally {
      await admin.unsafe(
        'drop trigger if exists phase4_reject_link_audit on app.audit_events; drop function if exists app.phase4_reject_link_audit()',
      );
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 120_000);

  it('leaves the live link intact when a direct caller swallows malformed rotation input', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedGuide();
    const admin = localAdmin();
    try {
      const session = await sessionFor(await createLink(host, propertyId));
      const snapshot = () =>
        admin<{ enabled: boolean; digest: boolean; sessions: number; audits: number }[]>`
          select l.enabled, l.secret_hmac is not null as digest,
            (select count(*)::int from app.guest_sessions s where s.share_link_id = l.id) as sessions,
            (select count(*)::int from app.audit_events where actor_id = ${host.userId}) as audits
          from app.share_links l where l.id = ${session.link.shareId}
        `;
      const before = (await snapshot())[0];
      expect(before).toEqual({ enabled: true, digest: true, sessions: 1, audits: expect.any(Number) });
      expect(before?.audits).toBeGreaterThan(0);

      // Catching the canonical error inside the callback must not be able to commit a partial
      // rotation: the malformed replacement is rejected before anything is disabled.
      await withOwnerContext(host.userId, async (tx) => {
        await expect(rotateShareLink(tx, { propertyId, id: 'malformed-id', hmac: Buffer.alloc(4) })).rejects.toThrow(
          'invalid_input',
        );
      });

      expect((await snapshot())[0]).toEqual(before);
      expect((await document(session.link.shareId, session.guestCookie)).html).toContain(PUBLISHED_BODY);
      expect(await countLinks(admin, propertyId)).toBe(1);
      await withOwnerContext(host.userId, async (tx) => {
        const state = await readShareLinkState(tx, propertyId);
        expect(state?.link?.id).toBe(session.link.shareId);
      });
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 120_000);
});
