// Phase 6 guest-message intake and host inbox against the real local stack and dev server: bounded
// store-once submission under a live session, duplicate/rate-limited/revoked/unpublished denials,
// inbox actions with their audit rows, the minimal alert mail (raw Mailpit payload), and
// aggregate-only counters that leave translation egress untouched.
// Requires `bun run db:start` and `bun run dev`; runs inside `bun run test` and skips without them.
// Run directly with: bun run test:local (synthetic data only; never a remote environment).
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from '../lib/db.server';
import { serverEnv } from '../lib/env.server';
import { utcWindow } from '../features/guest/guest-counters.server';
import {
  adminClient,
  decode,
  detectDevServer,
  detectLocalDb,
  detectLocalStack,
  fnCall,
  localAdmin,
  quoteLiteral,
  verifiedHost,
  type LocalStack,
  type VerifiedHost,
} from './integration-helpers';
import { duplicateWindowMinutes } from '../features/messages/message-validation';
import { duplicateFingerprint, messageRateFingerprints, type InboxMessage } from '../features/messages/messages.server';
import { GUEST_EXCHANGES_PER_HOUR } from '../features/share/share.server';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp ? describe : describe.skip;

const APP = 'http://localhost:3000';
const GUIDE_FNS = '/src/features/guide/guide-fns.ts?tss-serverfn-split';
const SHARE_FNS = '/src/features/share/share-fns.ts?tss-serverfn-split';
const MESSAGE_FNS = '/src/features/messages/messages-fns.ts?tss-serverfn-split';
const PUBLISHED_BODY = 'SYNTHETIC-PUBLISHED-BODY-OK';
const BODY_MARKER = 'SYNTHETIC-PHASE6-BODY-NEVER-EGRESS';
const REPLY_MARKER = 'synthetic-phase6-reply@example.test';

type ShareLink = { shareId: string; secret: string };
type GuestSession = { link: ShareLink; guestCookie: string; guestToken: string };

function devServerLog(): string | null {
  const path =
    process.env.DEV_SERVER_LOG ?? fileURLToPath(new URL('../../.git/orchestration/dev-server.log', import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

afterAll(async () => {
  await sql.end({ timeout: 0 });
});

const guideFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(GUIDE_FNS, name, options);
const shareFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(SHARE_FNS, name, options);
const messageFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(MESSAGE_FNS, name, options);

async function createProperty(host: VerifiedHost): Promise<string> {
  const created = decode<{ propertyId: string }>(
    await guideFn('createProperty', {
      jar: host.jar,
      data: { displayName: 'Phase 6 inbox villa (synthetic)' },
    }),
  )?.result;
  if (!created?.propertyId) throw new Error('synthetic property creation failed');
  return created.propertyId;
}

// One published guest section so the guest page read succeeds and the open counter can bump.
async function publishedProperty(): Promise<{ host: VerifiedHost; propertyId: string }> {
  const host = await verifiedHost(localStack as LocalStack, 'messages');
  const propertyId = await createProperty(host);
  const created = decode<{ sectionId: string }>(
    await guideFn('createSection', { jar: host.jar, data: { propertyId, category: 'wifi' } }),
  )?.result;
  if (!created?.sectionId) throw new Error('synthetic section creation failed');
  const saved = decode<{ ok?: boolean }>(
    await guideFn('saveSection', {
      jar: host.jar,
      data: {
        propertyId,
        sectionId: created.sectionId,
        category: 'wifi',
        title: 'Guest Wi-Fi',
        body: PUBLISHED_BODY,
        visibility: 'guest',
        secretValue: '',
        published: true,
      },
    }),
  )?.result;
  if (!saved?.ok) throw new Error('synthetic section save failed');
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

// One enabled link per property: a second issuance is a rotation, which kills the old sessions.
async function rotateLink(host: VerifiedHost, propertyId: string): Promise<ShareLink> {
  const issued = decode<{ shareId?: string; secret?: string }>(
    await shareFn('rotateGuestLink', { jar: host.jar, data: { propertyId } }),
  )?.result;
  if (!issued?.shareId || !issued.secret) throw new Error('synthetic link rotation failed');
  return { shareId: issued.shareId, secret: issued.secret };
}

async function exchange(shareId: string, secret: string, origin = APP) {
  const response = await fetch(`${APP}/g/${shareId}/exchange`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ secret }),
    redirect: 'manual',
  });
  return { status: response.status, setCookies: response.headers.getSetCookie() };
}

async function sessionFor(link: ShareLink): Promise<GuestSession> {
  const exchanged = await exchange(link.shareId, link.secret);
  const guestCookie = exchanged.setCookies.find((value) => value.startsWith('sw_guest='))?.split(';')[0] ?? null;
  if (exchanged.status !== 200 || !guestCookie) throw new Error('synthetic exchange failed');
  return { link, guestCookie, guestToken: guestCookie.slice('sw_guest='.length) };
}

async function document(shareId: string, guestCookie?: string) {
  const response = await fetch(`${APP}/g/${shareId}`, {
    headers: guestCookie ? { cookie: guestCookie } : {},
    redirect: 'manual',
  });
  return { status: response.status, html: await response.text() };
}

type SubmitOptions = { origin?: string; contentType?: string; raw?: string; method?: string };

async function submit(
  shareId: string,
  guestCookie: string,
  payload: Record<string, unknown>,
  options: SubmitOptions = {},
) {
  const response = await fetch(`${APP}/g/${shareId}/message`, {
    method: options.method ?? 'POST',
    headers: {
      origin: options.origin ?? APP,
      'content-type': options.contentType ?? 'application/json',
      ...(guestCookie ? { cookie: guestCookie } : {}),
    },
    body: options.method === 'GET' ? undefined : (options.raw ?? JSON.stringify(payload)),
    redirect: 'manual',
  });
  const text = await response.text();
  let json: { state?: string; fields?: Record<string, string> } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    json,
    text,
  };
}

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'question',
    category: 'wifi',
    locale: 'de',
    body: BODY_MARKER,
    replyEmail: '',
    ...overrides,
  };
}

// Chunked upload without Content-Length: the server must bound the raw bytes as they arrive.
async function submitStreamed(
  shareId: string,
  guestCookie: string,
  chunks: Uint8Array[],
): Promise<{ status: number; json: { state?: string } | null; text: string; aborted: boolean }> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json', cookie: guestCookie },
    body,
    duplex: 'half',
    redirect: 'manual',
  };
  try {
    const response = await fetch(`${APP}/g/${shareId}/message`, init);
    const text = await response.text();
    let json: { state?: string } | null = null;
    try {
      json = JSON.parse(text) as { state?: string };
    } catch {
      json = null;
    }
    return { status: response.status, json, text, aborted: false };
  } catch {
    // The server answers and cancels the reader; the client may lose the upload instead of the reply.
    return { status: 0, json: null, text: '', aborted: true };
  }
}

// A deliberately wrong, larger Content-Length: the early rejection must answer without reading it.
function submitDeclared(
  shareId: string,
  guestCookie: string,
  declared: number,
  body: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host: 'localhost',
        port: 3000,
        path: `/g/${shareId}/message`,
        method: 'POST',
        headers: {
          origin: APP,
          'content-type': 'application/json',
          cookie: guestCookie,
          'content-length': String(declared),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text }));
      },
    );
    request.on('error', () => resolve({ status: 0, text: '' }));
    request.end(body);
  });
}

async function alertMessages(local: LocalStack, email: string): Promise<{ ID: string; Subject: string }[]> {
  const response = await fetch(`${local.mailpitUrl}/api/v1/search?query=to%3A${encodeURIComponent(email)}`, {
    method: 'GET',
  });
  const body = (await response.json()) as { messages?: { ID: string; Subject: string }[] };
  // The same mailbox also receives the MFA security notice; only the alert subject counts here.
  return (body.messages ?? []).filter((entry) => entry.Subject === 'You have a new guest message');
}

async function rawMail(local: LocalStack, id: string): Promise<string> {
  const response = await fetch(`${local.mailpitUrl}/api/v1/message/${id}/raw`);
  return response.text();
}

describeLocal('guest message intake and host inbox against the local stack', () => {
  it('stores one verbatim message per submission for the link property without translation egress', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    const admin = localAdmin();
    const logBefore = devServerLog()?.length ?? 0;
    try {
      expect(serverEnv.googleTranslateServiceAccount).toBeNull();
      const session = await sessionFor(await createLink(host, propertyId));
      expect((await document(session.link.shareId, session.guestCookie)).status).toBe(200);

      const question = await submit(
        session.link.shareId,
        session.guestCookie,
        message({ body: `${BODY_MARKER}\nZeile zwei` }),
      );
      expect(question.status).toBe(200);
      expect(question.json?.state).toBe('ok');
      expect(question.cacheControl).toBe('private, no-store');
      expect(question.text).not.toContain(BODY_MARKER);

      const report = await submit(
        session.link.shareId,
        session.guestCookie,
        message({
          kind: 'issue',
          category: 'parking',
          locale: 'sl',
          body: 'Synthetic issue line',
          replyEmail: REPLY_MARKER,
        }),
      );
      expect(report.status).toBe(200);
      expect(report.json?.state).toBe('ok');

      const rows = await admin<
        {
          kind: string;
          category: string | null;
          locale: string;
          body: string;
          follow_up_email: string | null;
          state: string;
          answer_in_guide: boolean | null;
          handled_at: string | null;
          property_id: string;
        }[]
      >`
        select kind, category, locale, body, follow_up_email, state, answer_in_guide, handled_at::text, property_id
        from app.guest_messages where property_id = ${propertyId} order by created_at asc, id asc
      `;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        kind: 'question',
        category: 'wifi',
        locale: 'de',
        body: `${BODY_MARKER}\nZeile zwei`,
        follow_up_email: null,
        state: 'new',
        answer_in_guide: null,
        handled_at: null,
        property_id: propertyId,
      });
      expect(rows[1]).toMatchObject({
        kind: 'issue',
        category: 'parking',
        locale: 'sl',
        follow_up_email: REPLY_MARKER,
      });

      // Stored columns carry no session, link, or network identifiers.
      const [columns] = await admin<{ cols: string[] }[]>`
        select array_agg(column_name order by ordinal_position)::text[] as cols
        from information_schema.columns
        where table_schema = 'app' and table_name = 'guest_messages'
      `;
      expect(columns?.cols).toEqual([
        'id',
        'property_id',
        'kind',
        'category',
        'body',
        'follow_up_email',
        'state',
        'answer_in_guide',
        'handled_at',
        'created_at',
        'locale',
      ]);

      const [counters] = await admin<
        { link_exchanges: number; guide_opens: number; submissions: number; cols: string[] }[]
      >`
        select c.link_exchanges, c.guide_opens, c.submissions, d.cols
        from app.guest_counters c,
          (select array_agg(column_name order by ordinal_position)::text[] as cols
           from information_schema.columns
           where table_schema = 'app' and table_name = 'guest_counters') d
        where c.property_id = ${propertyId}
      `;
      expect(counters?.link_exchanges).toBe(1);
      expect(counters?.guide_opens).toBe(1);
      expect(counters?.submissions).toBe(2);
      expect(counters?.cols).toEqual(['property_id', 'day', 'link_exchanges', 'guide_opens', 'submissions']);

      // Guest intake never reaches translation storage or provider metadata.
      const [translations] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.guide_translations t
        join app.guide_sections s on s.id = t.section_id
        where s.property_id = ${propertyId}
      `;
      expect(translations?.n).toBe(0);
      const [hostAudits] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.audit_events
        where actor_id = ${host.userId} and action like 'translation_%'
      `;
      expect(hostAudits?.n).toBe(0);

      const logSlice = devServerLog()?.slice(logBefore) ?? null;
      if (logSlice !== null) {
        expect(logSlice).not.toContain(BODY_MARKER);
        expect(logSlice).not.toContain(REPLY_MARKER);
        expect(logSlice).not.toContain(session.guestToken);
      }
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 90_000);

  it('denies unknown, cookie-less, malformed, cross-property, revoked, unpublished, and oversized intake', async () => {
    const local = localStack as LocalStack;
    const first = await publishedProperty();
    const second = await publishedProperty();
    const admin = localAdmin();
    try {
      const session = await sessionFor(await createLink(first.host, first.propertyId));
      const foreign = await createLink(second.host, second.propertyId);

      const denied = [
        await submit('z'.repeat(22), session.guestCookie, message()),
        await submit(session.link.shareId, '', message()),
        await submit(session.link.shareId, 'sw_guest=short', message()),
        await submit(foreign.shareId, session.guestCookie, message()),
        await submit(session.link.shareId, session.guestCookie, message(), { origin: 'https://attacker.example' }),
        await submit(session.link.shareId, session.guestCookie, message(), { contentType: 'text/plain' }),
        await submit(session.link.shareId, session.guestCookie, {}, { raw: `"${'x'.repeat(9000)}"` }),
      ];
      for (const reply of denied) {
        expect(reply.status).toBe(403);
        expect(reply.json?.state).toBe('denied');
        expect(reply.cacheControl).toBe('private, no-store');
      }
      // The intake route answers only POST; anything else is a method denial without a body.
      const method = await submit(session.link.shareId, session.guestCookie, message(), { method: 'GET' });
      expect(method.status).toBe(405);
      expect(method.text).toBe('');

      const invalid = [
        { reply: await submit(session.link.shareId, session.guestCookie, message({ kind: 'chat' })), field: 'kind' },
        {
          reply: await submit(session.link.shareId, session.guestCookie, message({ category: '' })),
          field: 'category',
        },
        { reply: await submit(session.link.shareId, session.guestCookie, message({ body: '' })), field: 'body' },
        {
          reply: await submit(session.link.shareId, session.guestCookie, message({ body: 'x'.repeat(2001) })),
          field: 'body',
        },
        {
          reply: await submit(session.link.shareId, session.guestCookie, message({ replyEmail: 'not-an-address' })),
          field: 'replyEmail',
        },
      ];
      for (const { reply, field } of invalid) {
        expect(reply.status).toBe(400);
        expect(reply.json?.state).toBe('invalid');
        expect(reply.json?.fields?.[field]).toEqual(expect.any(String));
        expect(reply.text).not.toContain(BODY_MARKER);
      }

      // Rotation and disable revoke a captured session; an unpublished guide stops intake too.
      const replacement = await rotateLink(first.host, first.propertyId);
      expect((await submit(session.link.shareId, session.guestCookie, message())).status).toBe(403);
      expect((await submit(replacement.shareId, session.guestCookie, message())).status).toBe(403);

      const fresh = await sessionFor(await rotateLink(first.host, first.propertyId));
      await guideFn('setGuidePublished', {
        jar: first.host.jar,
        data: { propertyId: first.propertyId, published: false },
      });
      expect((await submit(fresh.link.shareId, fresh.guestCookie, message())).status).toBe(403);
      await guideFn('setGuidePublished', {
        jar: first.host.jar,
        data: { propertyId: first.propertyId, published: true },
      });
      expect((await submit(fresh.link.shareId, fresh.guestCookie, message())).status).toBe(200);

      // An expired session is the same denial as a missing one.
      const expiring = await sessionFor(await rotateLink(first.host, first.propertyId));
      await admin`
        update app.guest_sessions set expires_at = now() - interval '1 second'
        where share_link_id = ${expiring.link.shareId}
      `;
      expect((await submit(expiring.link.shareId, expiring.guestCookie, message())).status).toBe(403);

      const [stored] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.guest_messages
        where property_id = ${first.propertyId} or property_id = ${second.propertyId}
      `;
      expect(stored?.n).toBe(1);
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(first.host.userId);
      await adminClient(local).deleteUser(second.host.userId);
    }
  }, 120_000);

  it('answers a duplicate retry once and closes the session hour window with counted denials', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    const admin = localAdmin();
    try {
      const session = await sessionFor(await createLink(host, propertyId));
      const first = await submit(
        session.link.shareId,
        session.guestCookie,
        message({ body: 'Synthetic duplicate body' }),
      );
      expect(first.status).toBe(200);
      const retry = await submit(
        session.link.shareId,
        session.guestCookie,
        message({ body: 'Synthetic duplicate body' }),
      );
      expect(retry.status).toBe(200);
      expect(retry.json?.state).toBe('ok');

      const [afterRetry] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.guest_messages where property_id = ${propertyId}
      `;
      expect(afterRetry?.n).toBe(1);
      expect((await alertMessages(local, host.email)).length).toBe(1);

      for (const body of ['Second', 'Third', 'Fourth']) {
        const reply = await submit(
          session.link.shareId,
          session.guestCookie,
          message({ body: `Synthetic ${body} body` }),
        );
        expect(reply.status).toBe(200);
      }
      // Five allowed attempts are already spent (the first submission plus its suppressed retry),
      // so the sixth attempt is the first denial.
      const denied = await submit(session.link.shareId, session.guestCookie, message({ body: 'Synthetic sixth body' }));
      expect(denied.status).toBe(429);
      expect(denied.json?.state).toBe('rate_limited');
      expect(denied.text).not.toContain('Synthetic sixth body');

      const [stored] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.guest_messages where property_id = ${propertyId}
      `;
      expect(stored?.n).toBe(4);
      // Denied attempts commit their increments, and a denied submission sends no alert.
      expect((await alertMessages(local, host.email)).length).toBe(4);

      const fingerprints = messageRateFingerprints({
        shareId: session.link.shareId,
        propertyId,
        sessionToken: session.guestToken,
      });
      const [sessionWindow] = await admin<{ count: number }[]>`
        select count from app.rate_limits
        where key_hash = ${fingerprints.session} and window_start = ${utcWindow(3600)}
      `;
      expect(sessionWindow?.count).toBe(6);
      // The session denial stops there, so one flooding session cannot spend the wider quotas.
      const [linkWindow] = await admin<{ count: number }[]>`
        select count from app.rate_limits
        where key_hash = ${fingerprints.link} and window_start = ${utcWindow(3600)}
      `;
      expect(linkWindow?.count).toBe(5);
      const [propertyWindow] = await admin<{ count: number }[]>`
        select count from app.rate_limits
        where key_hash = ${fingerprints.property} and window_start = ${utcWindow(86_400)}
      `;
      expect(propertyWindow?.count).toBe(5);
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 120_000);

  // Regression: the duplicate key once covered only session, kind, and body, so a genuinely
  // different submission with the same text was answered as a successful retry and discarded.
  it('stores distinct submissions that share one body but differ in category, locale, or reply address', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    const admin = localAdmin();
    try {
      const session = await sessionFor(await createLink(host, propertyId));
      const body = 'Synthetic shared body';
      const first = await submit(session.link.shareId, session.guestCookie, message({ body }));
      expect(first.status).toBe(200);
      expect(first.json?.state).toBe('ok');
      // The exact retry stays suppressed: same message, counted once, stored once.
      const retry = await submit(session.link.shareId, session.guestCookie, message({ body }));
      expect(retry.status).toBe(200);
      expect(retry.json?.state).toBe('ok');

      const otherCategory = await submit(
        session.link.shareId,
        session.guestCookie,
        message({ body, category: 'parking' }),
      );
      const otherLocale = await submit(session.link.shareId, session.guestCookie, message({ body, locale: 'sl' }));
      const withReply = await submit(
        session.link.shareId,
        session.guestCookie,
        message({ body, replyEmail: REPLY_MARKER }),
      );
      for (const reply of [otherCategory, otherLocale, withReply]) {
        expect(reply.status).toBe(200);
        expect(reply.json?.state).toBe('ok');
      }

      const rows = await admin<{ category: string; locale: string; follow_up_email: string | null }[]>`
        select category, locale, follow_up_email from app.guest_messages
        where property_id = ${propertyId} order by created_at asc, id asc
      `;
      expect(rows.map((row) => `${row.category}|${row.locale}|${row.follow_up_email ?? '-'}`).sort()).toEqual([
        'parking|de|-',
        'wifi|de|-',
        `wifi|de|${REPLY_MARKER}`,
        'wifi|sl|-',
      ]);
      // Each stored submission alerted once; the suppressed exact retry sent nothing.
      expect((await alertMessages(local, host.email)).length).toBe(4);
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 120_000);

  // Regression: two identical retries racing each other must still store and alert exactly once,
  // while both attempts stay counted (the rate window is not reset by the suppression).
  it('stores one message for concurrent identical retries and keeps both attempts counted', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    const admin = localAdmin();
    try {
      const session = await sessionFor(await createLink(host, propertyId));
      const body = 'Synthetic concurrent body';
      const [first, second] = await Promise.all([
        submit(session.link.shareId, session.guestCookie, message({ body })),
        submit(session.link.shareId, session.guestCookie, message({ body })),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.json?.state).toBe('ok');
      expect(second.json?.state).toBe('ok');

      const [stored] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.guest_messages where property_id = ${propertyId}
      `;
      expect(stored?.n).toBe(1);
      expect((await alertMessages(local, host.email)).length).toBe(1);

      const fingerprints = messageRateFingerprints({
        shareId: session.link.shareId,
        propertyId,
        sessionToken: session.guestToken,
      });
      const [sessionWindow] = await admin<{ count: number }[]>`
        select count from app.rate_limits
        where key_hash = ${fingerprints.session} and window_start = ${utcWindow(3600)}
      `;
      expect(sessionWindow?.count).toBe(2);
      const duplicateKey = duplicateFingerprint({
        sessionToken: session.guestToken,
        kind: 'question',
        category: 'wifi',
        locale: 'de',
        body,
        replyEmail: null,
      });
      const [duplicateWindow] = await admin<{ count: number }[]>`
        select count from app.rate_limits
        where key_hash = ${duplicateKey} and window_start = ${utcWindow(duplicateWindowMinutes * 60)}
      `;
      expect(duplicateWindow?.count).toBe(2);
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 120_000);

  it('bounds the raw request by bytes while streaming and stores only valid bodies', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    const admin = localAdmin();
    try {
      const session = await sessionFor(await createLink(host, propertyId));

      const nonAscii = 'Gdje je Wi-Fi? 你好 ünë — OK';
      const stored = await submit(session.link.shareId, session.guestCookie, message({ body: nonAscii }));
      expect(stored.status).toBe(200);
      expect(stored.json?.state).toBe('ok');
      const [row] = await admin<{ body: string }[]>`
        select body from app.guest_messages where property_id = ${propertyId}
      `;
      expect(row?.body).toBe(nonAscii);

      // Shorter than the bound in UTF-16 characters, larger in UTF-8 bytes.
      const multibyte = await submit(
        session.link.shareId,
        session.guestCookie,
        message({ body: 'ok', padding: '界'.repeat(4000) }),
      );
      expect(multibyte.status).toBe(403);
      expect(multibyte.json?.state).toBe('denied');
      expect(multibyte.text).not.toContain('界');

      // No Content-Length (chunked): the incremental byte count governs both ways.
      const encoder = new TextEncoder();
      const chunked = await submitStreamed(session.link.shareId, session.guestCookie, [
        encoder.encode(JSON.stringify(message({ body: 'Synthetic chunked body' }))),
      ]);
      expect(chunked.status).toBe(200);
      expect(chunked.json?.state).toBe('ok');

      const oversized = await submitStreamed(session.link.shareId, session.guestCookie, [
        encoder.encode(`{"padding":"${'x'.repeat(12_000)}"}`),
      ]);
      // The server denies as soon as the bound is crossed, cancels the reader, and answers with the
      // same one-line denial as every other refusal — the client never sees the sent bytes echoed.
      expect(oversized.status).toBe(403);
      expect(oversized.json?.state).toBe('denied');
      expect(oversized.text).not.toContain('xxxx');

      // A declared Content-Length beyond the bound is rejected before the body is read.
      const declared = await submitDeclared(
        session.link.shareId,
        session.guestCookie,
        100_000,
        JSON.stringify(message()),
      );
      expect(declared.status).toBe(403);
      expect(declared.text).not.toContain(BODY_MARKER);

      const [counts] = await admin<{ n: number; submissions: number }[]>`
        select (select count(*)::int from app.guest_messages where property_id = ${propertyId}) as n,
          (select submissions from app.guest_counters where property_id = ${propertyId}) as submissions
      `;
      expect(counts?.n).toBe(2);
      expect(counts?.submissions).toBe(2);
      expect((await alertMessages(local, host.email)).length).toBe(2);
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 120_000);

  it('rolls a tag change back when its audit row cannot be written', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    const admin = localAdmin();
    const marker = 'SYNTHETIC-PHASE6-TAG-AUDIT-FAILURE';
    try {
      const session = await sessionFor(await createLink(host, propertyId));
      const sent = await submit(session.link.shareId, session.guestCookie, message({ body: 'Synthetic tag rollback' }));
      expect(sent.status).toBe(200);
      const inbox =
        decode<{ messages: InboxMessage[] }>(await messageFn('getInbox', { jar: host.jar, data: { propertyId } }))
          ?.result?.messages ?? [];
      const messageId = inbox[0]?.id ?? '';
      const tagAuditCount = async () =>
        Number(
          (
            await admin<{ n: number }[]>`
              select count(*)::int as n from app.audit_events
              where actor_id = ${host.userId} and action = 'message_tagged'
            `
          )[0]?.n ?? -1,
        );
      const tagged = decode<{ ok?: boolean }>(
        await messageFn('tagInboxAnswer', {
          jar: host.jar,
          data: { propertyId, messageId, answerInGuide: true },
        }),
      )?.result;
      expect(tagged?.ok).toBe(true);
      expect(await tagAuditCount()).toBe(1);

      await admin.unsafe(`
        create or replace function app.phase6_reject_tag_audit() returns trigger language plpgsql as $$
        begin
          if new.actor_id = ${quoteLiteral(host.userId)}::uuid and new.action = 'message_tagged' then
            raise exception ${quoteLiteral(marker)};
          end if;
          return new;
        end $$;
        drop trigger if exists phase6_reject_tag_audit on app.audit_events;
        create trigger phase6_reject_tag_audit before insert on app.audit_events
          for each row execute function app.phase6_reject_tag_audit();
      `);
      const blocked = await messageFn('tagInboxAnswer', {
        jar: host.jar,
        data: { propertyId, messageId, answerInGuide: false },
      });
      expect(decode<{ error?: string }>(blocked)?.result?.error).toBe('unexpected');
      expect(JSON.stringify(blocked)).not.toContain(marker);
      const [rolledBack] = await admin<{ answer_in_guide: boolean | null }[]>`
        select answer_in_guide from app.guest_messages where id = ${messageId}
      `;
      expect(rolledBack?.answer_in_guide).toBe(true);
      expect(await tagAuditCount()).toBe(1);

      await admin.unsafe('drop trigger if exists phase6_reject_tag_audit on app.audit_events');
      const retagged = decode<{ ok?: boolean }>(
        await messageFn('tagInboxAnswer', {
          jar: host.jar,
          data: { propertyId, messageId, answerInGuide: false },
        }),
      )?.result;
      expect(retagged?.ok).toBe(true);
      expect(await tagAuditCount()).toBe(2);

      // Actor, action, time and check-constrained agent call metadata only — no free-text payload to leak into.
      const [cols] = await admin<{ cols: string[] }[]>`
        select array_agg(column_name order by ordinal_position)::text[] as cols
        from information_schema.columns where table_schema = 'app' and table_name = 'audit_events'
      `;
      expect(cols?.cols).toEqual([
        'id',
        'actor_id',
        'action',
        'created_at',
        'grant_id',
        'tool',
        'property_ids',
        'row_count',
        'outcome',
        'latency_ms',
        'args_digest',
      ]);
      const unchecked = await admin`
        select c.column_name from information_schema.columns c
        where c.table_schema = 'app' and c.table_name = 'audit_events' and c.data_type = 'text'
          and not exists (
            select 1 from pg_constraint k
            where k.conrelid = 'app.audit_events'::regclass and k.contype = 'c'
              and pg_get_constraintdef(k.oid) ~ ('\\m' || c.column_name || '\\M')
          )
      `;
      expect(unchecked).toEqual([]);
    } finally {
      await admin.unsafe('drop trigger if exists phase6_reject_tag_audit on app.audit_events');
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 120_000);

  it('closes the link hour window across sessions', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    const admin = localAdmin();
    try {
      const link = await createLink(host, propertyId);
      for (let session = 0; session < 4; session += 1) {
        const current = await sessionFor(link);
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const reply = await submit(
            link.shareId,
            current.guestCookie,
            message({ body: `Synthetic link window ${session}-${attempt}` }),
          );
          expect(reply.status).toBe(200);
        }
      }
      const fifth = await sessionFor(link);
      const denied = await submit(fifth.link.shareId, fifth.guestCookie, message({ body: 'Synthetic twenty-first' }));
      expect(denied.status).toBe(429);
      const [stored] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.guest_messages where property_id = ${propertyId}
      `;
      expect(stored?.n).toBe(20);
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 180_000);

  it('caps session exchanges per link hour, counting only matching secrets', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    try {
      const link = await createLink(host, propertyId);
      const wrongSecret = 'A'.repeat(43);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await exchange(link.shareId, wrongSecret)).status).toBe(403);
      }
      for (let attempt = 0; attempt < GUEST_EXCHANGES_PER_HOUR; attempt += 1) {
        expect((await exchange(link.shareId, link.secret)).status).toBe(200);
      }
      const capped = await exchange(link.shareId, link.secret);
      expect(capped.status).toBe(403);
      expect(capped.setCookies.some((value) => value.startsWith('sw_guest='))).toBe(false);
      // Rotation is the host's way out: the new link has its own window.
      await sessionFor(await rotateLink(host, propertyId));
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 120_000);

  it('closes the property day window at its cap and drops stale rate windows', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    const admin = localAdmin();
    try {
      const link = await createLink(host, propertyId);
      const session = await sessionFor(link);
      const fingerprints = messageRateFingerprints({
        shareId: link.shareId,
        propertyId,
        sessionToken: session.guestToken,
      });
      const staleWindow = new Date(utcWindow(86_400).getTime() - 86_400_000);
      await admin`
        insert into app.rate_limits (property_id, key_hash, window_start, count) values
          (${propertyId}, ${fingerprints.property}, ${utcWindow(86_400)}, 100),
          (${propertyId}, ${fingerprints.session}, ${staleWindow}, 3)
      `;

      const capped = await submit(
        session.link.shareId,
        session.guestCookie,
        message({ body: 'Synthetic capped body' }),
      );
      expect(capped.status).toBe(429);

      const [staleBefore] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.rate_limits
        where window_start = ${staleWindow} and key_hash = ${fingerprints.session}
      `;
      expect(staleBefore?.n).toBe(1);

      await admin`delete from app.rate_limits where key_hash = ${fingerprints.property}`;
      const stored = await submit(session.link.shareId, session.guestCookie, message({ body: 'Synthetic open body' }));
      expect(stored.status).toBe(200);
      const [staleAfter] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.rate_limits
        where window_start = ${staleWindow} and key_hash = ${fingerprints.session}
      `;
      expect(staleAfter?.n).toBe(0);
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(host.userId);
    }
  }, 90_000);

  it('serves the property inbox with audited actions and tenant isolation', async () => {
    const local = localStack as LocalStack;
    const first = await publishedProperty();
    const second = await publishedProperty();
    const admin = localAdmin();
    try {
      const session = await sessionFor(await createLink(first.host, first.propertyId));
      expect(
        (await submit(session.link.shareId, session.guestCookie, message({ body: 'Synthetic inbox question' }))).status,
      ).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(
        (
          await submit(
            session.link.shareId,
            session.guestCookie,
            message({
              kind: 'issue',
              category: 'rules',
              locale: 'en',
              body: 'Synthetic inbox issue',
              replyEmail: REPLY_MARKER,
            }),
          )
        ).status,
      ).toBe(200);

      const inbox = decode<{ messages: InboxMessage[] }>(
        await messageFn('getInbox', { jar: first.host.jar, data: { propertyId: first.propertyId } }),
      )?.result?.messages;
      expect(inbox).toHaveLength(2);
      expect(inbox?.[0]).toMatchObject({
        kind: 'issue',
        category: 'rules',
        locale: 'en',
        body: 'Synthetic inbox issue',
        followUpEmail: REPLY_MARKER,
        state: 'new',
        answerInGuide: null,
        handledAt: null,
      });
      expect(inbox?.[0]?.createdAt).toEqual(expect.any(String));
      expect(inbox?.[1]).toMatchObject({ kind: 'question', category: 'wifi', locale: 'de', followUpEmail: null });

      const questionId = inbox?.[1]?.id ?? '';
      const issueId = inbox?.[0]?.id ?? '';
      const tagAudits = async () =>
        Number(
          (
            await admin<{ n: number }[]>`
              select count(*)::int as n from app.audit_events
              where actor_id = ${first.host.userId} and action = 'message_tagged'
            `
          )[0]?.n ?? -1,
        );

      // Another host sees an empty list and can change nothing.
      const foreignRead = decode<{ messages: InboxMessage[] }>(
        await messageFn('getInbox', { jar: second.host.jar, data: { propertyId: first.propertyId } }),
      )?.result?.messages;
      expect(foreignRead).toEqual([]);
      const foreignWrite = decode<{ ok?: boolean }>(
        await messageFn('markInboxHandled', {
          jar: second.host.jar,
          data: { propertyId: first.propertyId, messageId: issueId },
        }),
      )?.result;
      expect(foreignWrite?.ok).toBe(false);
      const foreignTag = decode<{ ok?: boolean }>(
        await messageFn('tagInboxAnswer', {
          jar: second.host.jar,
          data: { propertyId: first.propertyId, messageId: questionId, answerInGuide: true },
        }),
      )?.result;
      expect(foreignTag?.ok).toBe(false);
      const [foreignAudits] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.audit_events
        where actor_id = ${second.host.userId} and action in ('message_handled', 'message_deleted', 'message_tagged')
      `;
      expect(foreignAudits?.n).toBe(0);

      const handled = decode<{ ok?: boolean }>(
        await messageFn('markInboxHandled', {
          jar: first.host.jar,
          data: { propertyId: first.propertyId, messageId: questionId },
        }),
      )?.result;
      expect(handled?.ok).toBe(true);
      const handledAgain = decode<{ ok?: boolean }>(
        await messageFn('markInboxHandled', {
          jar: first.host.jar,
          data: { propertyId: first.propertyId, messageId: questionId },
        }),
      )?.result;
      expect(handledAgain?.ok).toBe(false);
      const [handledRow] = await admin<{ state: string; handled_at: string | null }[]>`
        select state, handled_at::text from app.guest_messages where id = ${questionId}
      `;
      expect(handledRow?.state).toBe('handled');
      expect(handledRow?.handled_at).toEqual(expect.any(String));

      const tagged = decode<{ ok?: boolean }>(
        await messageFn('tagInboxAnswer', {
          jar: first.host.jar,
          data: { propertyId: first.propertyId, messageId: questionId, answerInGuide: true },
        }),
      )?.result;
      expect(tagged?.ok).toBe(true);
      expect(await tagAudits()).toBe(1);
      // A repeated value changes nothing, so it commits nothing and audits nothing.
      const taggedAgain = decode<{ ok?: boolean }>(
        await messageFn('tagInboxAnswer', {
          jar: first.host.jar,
          data: { propertyId: first.propertyId, messageId: questionId, answerInGuide: true },
        }),
      )?.result;
      expect(taggedAgain?.ok).toBe(false);
      expect(await tagAudits()).toBe(1);
      const issueTag = decode<{ ok?: boolean }>(
        await messageFn('tagInboxAnswer', {
          jar: first.host.jar,
          data: { propertyId: first.propertyId, messageId: issueId, answerInGuide: false },
        }),
      )?.result;
      expect(issueTag?.ok).toBe(false);
      expect(await tagAudits()).toBe(1);
      const [tagRow] = await admin<{ answer_in_guide: boolean | null }[]>`
        select answer_in_guide from app.guest_messages where id = ${issueId}
      `;
      expect(tagRow?.answer_in_guide).toBeNull();

      const deleted = decode<{ ok?: boolean }>(
        await messageFn('deleteInboxMessage', {
          jar: first.host.jar,
          data: { propertyId: first.propertyId, messageId: issueId },
        }),
      )?.result;
      expect(deleted?.ok).toBe(true);
      const [gone] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.guest_messages where id = ${issueId}
      `;
      expect(gone?.n).toBe(0);

      const audits = await admin<{ action: string }[]>`
        select action from app.audit_events where actor_id = ${first.host.userId} order by action
      `;
      expect(audits.map((row) => row.action).filter((action) => action.startsWith('message_'))).toEqual([
        'message_deleted',
        'message_handled',
        'message_tagged',
      ]);

      const anonymous = decode<{ error?: string }>(
        await messageFn('getInbox', { data: { propertyId: first.propertyId } }),
      );
      expect(anonymous?.result?.error).toBe('auth_required');
      const malformed = decode<{ error?: string }>(
        await messageFn('getInbox', { jar: first.host.jar, data: { propertyId: 'not-a-uuid' } }),
      );
      expect(malformed?.result?.error).toBe('invalid_input');
    } finally {
      await admin.end({ timeout: 0 });
      await adminClient(local).deleteUser(first.host.userId);
      await adminClient(local).deleteUser(second.host.userId);
    }
  }, 120_000);

  it('sends one minimal alert per stored message with no guest content', async () => {
    const local = localStack as LocalStack;
    const { host, propertyId } = await publishedProperty();
    try {
      const session = await sessionFor(await createLink(host, propertyId));
      const sent = await submit(
        session.link.shareId,
        session.guestCookie,
        message({ body: `${BODY_MARKER} alert payload`, replyEmail: REPLY_MARKER }),
      );
      expect(sent.status).toBe(200);

      const messages = await alertMessages(local, host.email);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.Subject).toBe('You have a new guest message');
      const raw = await rawMail(local, messages[0]?.ID ?? '');
      expect(raw).toContain('You have a new guest message');
      expect(raw).toContain(`To: ${host.email}`);
      // The serialized payload carries no guest words, no reply address, no category, no property.
      expect(raw).not.toContain(BODY_MARKER);
      expect(raw).not.toContain(REPLY_MARKER);
      expect(raw).not.toContain('wifi');
      expect(raw).not.toContain('Phase 6 inbox villa');
    } finally {
      await adminClient(local).deleteUser(host.userId);
    }
  }, 90_000);
});
