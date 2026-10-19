// Phase 5 stored localization against the real local stack. The real provider client (OAuth JWT
// bearer exchange plus the Google Cloud Translation Advanced EU endpoint) runs against a
// controlled transport double at the fetch boundary: no cloud call is made, and every request is
// captured for the serialized-payload exclusion checks. Requires `bun run db:start` and
// `bun run dev`; skips without them. Run with `bun run test:local` (synthetic data only).
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql, withLinkContext, withOwnerContext } from './db.server';
import type { GoogleTranslateCredentials } from './env.server';
import { readGuideEditor, readGuestGuide } from './guide.server';
import {
  APP,
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
import { exchangeGuestLink, insertShareLink, newShareLink, serializeGuestCookie } from './share.server';
import { generateTranslations } from './translation.server';

const localStack = detectLocalStack();
const localDbUp = await detectLocalDb();
const devServerUp = await detectDevServer();
const describeLocal = localStack && localDbUp && devServerUp ? describe : describe.skip;

const GUIDE_FNS = '/src/guide-fns.ts?tss-serverfn-split';
const TRANSLATION_FNS = '/src/translation-fns.ts?tss-serverfn-split';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TRANSLATE_URL =
  'https://translate-eu.googleapis.com/v3/projects/synthetic-translate-project/locations/europe-west1:translateText';

const PUBLISHED_BODY = 'SYNTHETIC-PUBLISHED-BODY-OK';
const SECOND_BODY = 'SYNTHETIC-SECOND-BODY-OK';
const DRAFT_BODY = 'SYNTHETIC-DRAFT-BODY-NEVER';
const NOTE_BODY = 'SYNTHETIC-NOTE-BODY-NEVER';
const SECRET_VALUE = 'SYNTHETIC-SECRET-NEVER';
const OTHER_PROPERTY_BODY = 'SYNTHETIC-OTHER-PROPERTY-BODY-NEVER';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials: GoogleTranslateCredentials = {
  clientEmail: 'synthetic-translate@example.iam.gserviceaccount.com',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  projectId: 'synthetic-translate-project',
};

const credentialState = vi.hoisted(() => ({ active: null as GoogleTranslateCredentials | null }));

// The provider module reads credentials at call time; nothing else about the real server env
// changes, and no credentials are ever read from or written to a real environment.
vi.mock('./env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./env.server')>();
  return {
    ...actual,
    get serverEnv() {
      return { ...actual.serverEnv, googleTranslateServiceAccount: credentialState.active };
    },
  };
});

type Captured = { url: string; headers: Record<string, string>; body: string };
type ProviderMode =
  | { kind: 'ok' }
  | { kind: 'token_error' }
  | { kind: 'translate_error' }
  | { kind: 'fail_sl' }
  | { kind: 'count_mismatch' }
  | { kind: 'empty_text' }
  | { kind: 'control_text' }
  | { kind: 'long_title' }
  | { kind: 'unauthorized' };

const requests: Captured[] = [];
let providerMode: ProviderMode = { kind: 'ok' };

// One controlled transport double for both allowlisted provider hosts; every other fetch (the
// local stack harness) passes straight through, so the app under test can still talk to its own
// local services while no provider call reaches the network.
const realFetch = globalThis.fetch.bind(globalThis);
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url !== TOKEN_URL && !url.startsWith('https://translate-eu.googleapis.com/v3/projects/')) {
    return realFetch(input as RequestInfo, init);
  }
  const headers = Object.fromEntries(
    Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]),
  );
  requests.push({ url, headers, body: String(init?.body ?? '') });
  if (url === TOKEN_URL) {
    if (providerMode.kind === 'token_error') return new Response('synthetic failure', { status: 500 });
    return Response.json({ access_token: 'synthetic-access-token', expires_in: 3600 });
  }
  if (providerMode.kind === 'translate_error') return new Response('synthetic failure', { status: 500 });
  if (providerMode.kind === 'unauthorized') return new Response('synthetic revoked', { status: 401 });
  const request = JSON.parse(String(init?.body ?? '{}')) as {
    contents: string[];
    targetLanguageCode: string;
  };
  if (providerMode.kind === 'fail_sl' && request.targetLanguageCode === 'sl') {
    return new Response('synthetic failure', { status: 500 });
  }
  if (providerMode.kind === 'count_mismatch') return Response.json({ translations: [{ translatedText: 'only one' }] });
  const translations = request.contents.map((content, index) => {
    if (providerMode.kind === 'empty_text' && index === 0) return { translatedText: '   ' };
    if (providerMode.kind === 'control_text' && index === 0) return { translatedText: 'bad\u0000text' };
    if (providerMode.kind === 'long_title' && index === 0) return { translatedText: 'x'.repeat(401) };
    return { translatedText: `${request.targetLanguageCode.toUpperCase()}#${index} ${content}` };
  });
  return Response.json({ translations });
});

const admin = localAdmin();
const hosts: VerifiedHost[] = [];

afterAll(async () => {
  for (const host of hosts) {
    await admin`delete from app.properties where owner_id = ${host.userId}`;
    await admin`delete from app.audit_events where actor_id = ${host.userId}`;
    await admin`delete from auth.users where id = ${host.userId}`;
  }
  await admin.end({ timeout: 0 });
  await sql.end({ timeout: 0 });
  vi.unstubAllGlobals();
});

beforeEach(() => {
  requests.length = 0;
  providerMode = { kind: 'ok' };
  credentialState.active = null;
});

async function newHost(label: string): Promise<VerifiedHost> {
  const host = await verifiedHost(localStack as LocalStack, label);
  hosts.push(host);
  return host;
}

const guideFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(GUIDE_FNS, name, options);
const translationFn = (name: string, options?: Parameters<typeof fnCall>[2]) => fnCall(TRANSLATION_FNS, name, options);

async function createProperty(host: VerifiedHost, enabledLocales: string[] = [], sourceLocale = 'en'): Promise<string> {
  const created = decode<{ propertyId: string }>(
    await guideFn('createProperty', {
      jar: host.jar,
      data: { displayName: 'Synthetic translation villa', sourceLocale, enabledLocales },
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

async function publishProperty(host: VerifiedHost, propertyId: string) {
  const published = decode<{ ok?: boolean }>(
    await guideFn('setGuidePublished', { jar: host.jar, data: { propertyId, published: true } }),
  )?.result;
  if (!published?.ok) throw new Error('synthetic publish failed');
}

async function guestRead(shareId: string, propertyId: string, locale: string | null) {
  return withLinkContext(shareId, async (tx) => {
    await tx`select set_config('app.link_property_id', ${propertyId}, true)`;
    return readGuestGuide(tx, propertyId, locale);
  });
}

async function linkFor(host: VerifiedHost, propertyId: string): Promise<string> {
  const link = newShareLink();
  const issued = await withOwnerContext(host.userId, (tx) =>
    insertShareLink(tx, { propertyId, id: link.id, hmac: link.hmac }),
  );
  if (!issued) throw new Error('synthetic link issuance failed');
  return link.id;
}

function contentsOf(captured: Captured): string[] {
  return (JSON.parse(captured.body) as { contents: string[] }).contents;
}

describeLocal('stored guide localization (synthetic provider double)', () => {
  // The dev server registers a module's server functions when the module graph first loads it, and
  // the property page imports the translation module on render; one authenticated page render makes
  // the HTTP server-function path available for the cross-host and provider-state probes below.
  beforeAll(async () => {
    const host = await newHost('translation-warmup');
    const propertyId = await createProperty(host, ['de']);
    const page = await fetch(`${APP}/host/properties/${propertyId}`, { headers: { cookie: host.jar.header() } });
    expect(page.status).toBe(200);
    await page.text();
    await admin`delete from app.properties where owner_id = ${host.userId}`;
    await admin`delete from auth.users where id = ${host.userId}`;
    hosts.splice(hosts.indexOf(host), 1);
  }, 60_000);

  it('sends exactly the eligible guest prose to the EU endpoint and stores drafts with one audit row', async () => {
    const host = await newHost('translation-egress');
    const propertyId = await createProperty(host, ['de', 'sl']);
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
    const rules = await createSection(host, propertyId, 'rules');
    await saveSection(host, {
      propertyId,
      sectionId: rules,
      category: 'rules',
      title: 'House rules',
      body: SECOND_BODY,
      visibility: 'guest',
      secretValue: '',
      published: true,
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
    const draft = await createSection(host, propertyId, 'checkout');
    await saveSection(host, {
      propertyId,
      sectionId: draft,
      category: 'checkout',
      title: 'Synthetic draft',
      body: DRAFT_BODY,
      visibility: 'guest',
      secretValue: '',
      published: false,
    });
    const otherProperty = await createProperty(host, ['de']);
    const otherSection = await createSection(host, otherProperty, 'wifi');
    await saveSection(host, {
      propertyId: otherProperty,
      sectionId: otherSection,
      category: 'wifi',
      title: 'Other property',
      body: OTHER_PROPERTY_BODY,
      visibility: 'guest',
      secretValue: '',
      published: true,
    });

    credentialState.active = credentials;
    providerMode = { kind: 'token_error' };
    expect(await generateTranslations({ propertyId, actorId: host.userId })).toEqual({
      state: 'provider_unavailable',
    });
    expect(await admin`select id from app.guide_translations where section_id in (${wifi}, ${rules})`).toHaveLength(0);

    providerMode = { kind: 'ok' };
    const outcome = await generateTranslations({ propertyId, actorId: host.userId });
    expect(outcome).toEqual({ state: 'generated', generated: 4, skipped: 0 });

    const tokenRequest = requests.filter((request) => request.url === TOKEN_URL);
    const translateRequests = requests.filter((request) => request.url === TRANSLATE_URL);
    // One failed exchange left nothing behind; the batch then acquired its token once and reused it.
    expect(tokenRequest).toHaveLength(2);
    expect(translateRequests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url === TOKEN_URL || request.url === TRANSLATE_URL).toBe(true);
    }

    const assertion = new URLSearchParams(tokenRequest.at(-1)!.body).get('assertion') ?? '';
    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const parsedClaims = JSON.parse(Buffer.from(claims!, 'base64url').toString()) as Record<string, unknown>;
    expect(parsedClaims.iss).toBe(credentials.clientEmail);
    expect(parsedClaims.scope).toBe('https://www.googleapis.com/auth/cloud-translation');
    expect(parsedClaims.aud).toBe(TOKEN_URL);
    expect(Number(parsedClaims.exp) - Number(parsedClaims.iat)).toBe(3600);
    expect(
      createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url')),
    ).toBe(true);

    for (const request of translateRequests) {
      expect(request.headers.authorization).toBe('Bearer synthetic-access-token');
      expect(request.headers['content-type']).toBe('application/json');
      expect(Object.keys(request.headers).sort()).toEqual(['authorization', 'content-type']);
      expect(Object.keys(JSON.parse(request.body) as object).sort()).toEqual([
        'contents',
        'mimeType',
        'sourceLanguageCode',
        'targetLanguageCode',
      ]);
      expect(JSON.parse(request.body)).toMatchObject({
        mimeType: 'text/plain',
        sourceLanguageCode: 'en',
      });
      expect(request.body).not.toContain(NOTE_BODY);
      expect(request.body).not.toContain(SECRET_VALUE);
      expect(request.body).not.toContain(DRAFT_BODY);
      expect(request.body).not.toContain(OTHER_PROPERTY_BODY);
      expect(request.body).not.toContain('Host note');
      expect(contentsOf(request).sort()).toEqual(['Guest Wi-Fi', 'House rules', PUBLISHED_BODY, SECOND_BODY].sort());
    }
    expect([...translateRequests].map((request) => JSON.parse(request.body).targetLanguageCode).sort()).toEqual([
      'de',
      'sl',
    ]);

    const rows = await admin<
      {
        section_id: string;
        locale: string;
        state: string;
        source_locale: string;
        title: string;
        body: string;
        provider: string;
      }[]
    >`select section_id, locale, state, source_locale, title, body, provider from app.guide_translations
      where section_id in (${wifi}, ${rules}) order by locale, section_id`;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.state).toBe('draft');
      expect(row.source_locale).toBe('en');
      expect(row.provider).toBe('google-translate-advanced');
      const tagged = row.title.match(/^(DE|SL)#(\d+) (Guest Wi-Fi|House rules)$/);
      expect(tagged).not.toBeNull();
      // The provider receives each section as a title/body pair, so a body always follows its title.
      expect(row.body.startsWith(`${tagged![1]}#${Number(tagged![2]) + 1} `)).toBe(true);
    }
    const audited = await admin`select action from app.audit_events
      where actor_id = ${host.userId} and action = 'translation_generated'`;
    expect(audited).toHaveLength(1);
  }, 60_000);

  it('serves only approved current translations, falls back with a flag, and never egresses on read', async () => {
    const host = await newHost('translation-serving');
    const propertyId = await createProperty(host, ['de', 'sl']);
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
    await publishProperty(host, propertyId);

    credentialState.active = credentials;
    expect(await generateTranslations({ propertyId, actorId: host.userId })).toEqual({
      state: 'generated',
      generated: 2,
      skipped: 0,
    });
    const [draft] = await admin<{ id: string; source_revision: number }[]>`select id, source_revision
      from app.guide_translations where section_id = ${wifi} and locale = 'de'`;
    const approved = decode<{ ok?: boolean }>(
      await translationFn('approveGuideTranslation', {
        jar: host.jar,
        data: {
          propertyId,
          translationId: draft!.id,
          sourceRevision: draft!.source_revision,
          title: 'Gast-WLAN',
          body: 'Synthetischer Gasttext',
        },
      }),
    )?.result;
    expect(approved?.ok).toBe(true);

    const shareId = await linkFor(host, propertyId);
    const callsBefore = requests.length;
    const german = await guestRead(shareId, propertyId, 'de');
    expect(german?.guest).toMatchObject({
      locale: 'de',
      locales: ['de', 'en', 'sl'],
      sections: [{ title: 'Gast-WLAN', body: 'Synthetischer Gasttext', fallback: false }],
    });
    const slovenian = await guestRead(shareId, propertyId, 'sl');
    expect(slovenian?.guest.sections).toEqual([
      { category: 'wifi', title: 'Guest Wi-Fi', body: PUBLISHED_BODY, fallback: true },
    ]);
    const source = await guestRead(shareId, propertyId, 'en');
    expect(source?.guest).toMatchObject({
      locale: 'en',
      sections: [{ title: 'Guest Wi-Fi', body: PUBLISHED_BODY, fallback: false }],
    });
    const unknown = await guestRead(shareId, propertyId, 'fr');
    expect(unknown?.guest.locale).toBe('en');
    expect(unknown?.guest.sections.at(0)?.fallback).toBe(false);
    expect(requests.length).toBe(callsBefore);

    const editor = await withOwnerContext(host.userId, (tx) => readGuideEditor(tx, propertyId));
    expect(editor?.property.enabledLocales).toEqual(['de', 'sl']);
    expect(editor?.sections[0]?.translations).toMatchObject([
      { locale: 'de', state: 'approved', stale: false },
      { locale: 'sl', state: 'draft', stale: false },
    ]);

    const other = await newHost('translation-foreign');
    const foreignHttp = decode<{ error?: string; state?: string }>(
      await translationFn('generateGuideTranslations', { jar: other.jar, data: { propertyId } }),
    )?.result;
    expect(foreignHttp?.error).toBe('invalid_input');
    expect(foreignHttp?.state).toBeUndefined();
    const foreignCanonical = await generateTranslations({ propertyId, actorId: other.userId });
    expect(foreignCanonical).toEqual({ state: 'invalid_input' });
    const foreignApprove = decode<{ error?: string }>(
      await translationFn('approveGuideTranslation', {
        jar: other.jar,
        data: {
          propertyId,
          translationId: draft!.id,
          sourceRevision: draft!.source_revision,
          title: 'Hijack',
          body: 'Hijack',
        },
      }),
    )?.result;
    expect(foreignApprove?.error).toBe('invalid_input');
    const untouched = await admin<{ title: string }[]>`select title from app.guide_translations
      where id = ${draft!.id}`;
    expect(untouched[0]?.title).toBe('Gast-WLAN');
  }, 60_000);

  it('marks translations stale on source edits, category changes, and locale switches, and regenerates drafts', async () => {
    const host = await newHost('translation-stale');
    const propertyId = await createProperty(host, ['de']);
    const wifi = await createSection(host, propertyId, 'wifi');
    const section = {
      propertyId,
      sectionId: wifi,
      category: 'wifi',
      title: 'Guest Wi-Fi',
      body: PUBLISHED_BODY,
      visibility: 'guest',
      secretValue: '',
      published: true,
    };
    await saveSection(host, section);
    await publishProperty(host, propertyId);
    const [baseline] = await admin<{ source_revision: number }[]>`select source_revision from app.guide_sections
      where id = ${wifi}`;

    credentialState.active = credentials;
    expect(await generateTranslations({ propertyId, actorId: host.userId })).toEqual({
      state: 'generated',
      generated: 1,
      skipped: 0,
    });
    const [row] = await admin<{ id: string; source_revision: number }[]>`select id, source_revision
      from app.guide_translations where section_id = ${wifi}`;
    expect(
      decode<{ ok?: boolean }>(
        await translationFn('approveGuideTranslation', {
          jar: host.jar,
          data: {
            propertyId,
            translationId: row!.id,
            sourceRevision: row!.source_revision,
            title: 'Gast-WLAN',
            body: 'Synthetischer Gasttext',
          },
        }),
      )?.result?.ok,
    ).toBe(true);

    const shareId = await linkFor(host, propertyId);
    expect((await guestRead(shareId, propertyId, 'de'))?.guest.sections.at(0)?.title).toBe('Gast-WLAN');

    await saveSection(host, { ...section, body: `${PUBLISHED_BODY} edited` });
    const [edited] = await admin<{ source_revision: number }[]>`select source_revision from app.guide_sections
      where id = ${wifi}`;
    expect(edited?.source_revision).toBe(baseline!.source_revision + 1);
    expect(await guestRead(shareId, propertyId, 'de')).toMatchObject({
      guest: { sections: [{ title: 'Guest Wi-Fi', fallback: true }] },
    });
    const afterEdit = await withOwnerContext(host.userId, (tx) => readGuideEditor(tx, propertyId));
    expect(afterEdit?.sections[0]?.translations[0]).toMatchObject({ state: 'approved', stale: true });

    expect(await generateTranslations({ propertyId, actorId: host.userId })).toEqual({
      state: 'generated',
      generated: 1,
      skipped: 0,
    });
    const [regenerated] = await admin<{ id: string; state: string; source_revision: number }[]>`
      select id, state, source_revision from app.guide_translations where section_id = ${wifi}`;
    expect(regenerated).toMatchObject({ state: 'draft' });
    expect(regenerated?.source_revision).toBe(edited?.source_revision);
    expect(regenerated?.id).toBe(row!.id);
    const staleApprove = decode<{ error?: string }>(
      await translationFn('approveGuideTranslation', {
        jar: host.jar,
        data: {
          propertyId,
          translationId: regenerated!.id,
          sourceRevision: baseline!.source_revision,
          title: 'Veraltet',
          body: 'Veralteter Text',
        },
      }),
    )?.result;
    expect(staleApprove?.error).toBeDefined();
    const [stillDraft] = await admin<{ state: string; title: string }[]>`select state, title
      from app.guide_translations where id = ${regenerated!.id}`;
    expect(stillDraft).toMatchObject({ state: 'draft' });
    expect(stillDraft?.title).not.toBe('Veraltet');
    expect(await generateTranslations({ propertyId, actorId: host.userId })).toEqual({
      state: 'generated',
      generated: 0,
      skipped: 1,
    });

    await saveSection(host, { ...section, body: `${PUBLISHED_BODY} edited`, category: 'rules' });
    const [categorised] = await admin<{ source_revision: number }[]>`select source_revision from app.guide_sections
      where id = ${wifi}`;
    expect(categorised?.source_revision).toBe(baseline!.source_revision + 2);
    expect(await guestRead(shareId, propertyId, 'de')).toMatchObject({
      guest: { sections: [{ fallback: true }] },
    });

    await saveSection(host, { ...section, body: `${PUBLISHED_BODY} edited`, category: 'rules', visibility: 'host' });
    const [hidden] = await admin<{ source_revision: number }[]>`select source_revision from app.guide_sections
      where id = ${wifi}`;
    expect(hidden?.source_revision).toBe(baseline!.source_revision + 3);
    expect(await guestRead(shareId, propertyId, 'de')).toMatchObject({ guest: { sections: [] } });

    const switched = decode<{ ok?: boolean }>(
      await guideFn('saveProperty', {
        jar: host.jar,
        data: { propertyId, displayName: 'Synthetic translation villa', sourceLocale: 'sl', enabledLocales: ['de'] },
      }),
    )?.result;
    expect(switched?.ok).toBe(true);
    const afterSwitch = await withOwnerContext(host.userId, (tx) => readGuideEditor(tx, propertyId));
    expect(afterSwitch?.sections[0]?.translations[0]).toMatchObject({ state: 'draft', stale: true });
  }, 60_000);

  it('blocks secret-like and contact-like prose before any egress and stores nothing', async () => {
    const host = await newHost('translation-blocked');
    const propertyId = await createProperty(host, ['de']);
    const gate = await createSection(host, propertyId, 'arrival');
    await saveSection(host, {
      propertyId,
      sectionId: gate,
      category: 'arrival',
      title: 'Arrival',
      body: 'The door code is BLUEBIRD.',
      visibility: 'guest',
      secretValue: '',
      published: true,
    });
    const contact = await createSection(host, propertyId, 'emergency');
    await saveSection(host, {
      propertyId,
      sectionId: contact,
      category: 'emergency',
      title: 'Contacts',
      body: 'Write to hosts@example.com if anything is wrong.',
      visibility: 'guest',
      secretValue: '',
      published: true,
    });
    await publishProperty(host, propertyId);

    credentialState.active = credentials;
    const blocked = await generateTranslations({ propertyId, actorId: host.userId });
    expect(blocked).toEqual({ state: 'blocked', sectionIds: [gate, contact] });
    expect(requests).toHaveLength(0);
    expect(await admin`select id from app.guide_translations where section_id in (${gate}, ${contact})`).toHaveLength(
      0,
    );
    expect(
      await admin`select id from app.audit_events where actor_id = ${host.userId} and action = 'translation_generated'`,
    ).toHaveLength(0);

    const httpBlocked = decode<{ state?: string; sectionIds?: string[] }>(
      await translationFn('generateGuideTranslations', { jar: host.jar, data: { propertyId } }),
    )?.result;
    expect(httpBlocked?.state).toBe('blocked');

    await saveSection(host, {
      propertyId,
      sectionId: gate,
      category: 'arrival',
      title: 'Arrival',
      body: 'Check-in is from 15:00; the key box is beside the gate.',
      visibility: 'guest',
      secretValue: '',
      published: true,
    });
    await saveSection(host, {
      propertyId,
      sectionId: contact,
      category: 'emergency',
      title: 'Contacts',
      body: 'Message your host through the guide if anything is wrong.',
      visibility: 'guest',
      secretValue: '',
      published: true,
    });
    expect(await generateTranslations({ propertyId, actorId: host.userId })).toEqual({
      state: 'generated',
      generated: 2,
      skipped: 0,
    });
  }, 60_000);

  it('blocks labelled credential assignments in every supported language before any egress', async () => {
    const host = await newHost('translation-credentials');
    const propertyId = await createProperty(host, ['de', 'sl']);
    // All values are lowercase with no digits, so only the label-plus-qualifier assignment rule can
    // block them.
    const cases = [
      { category: 'wifi', body: 'Wi-Fi password: summerhouse' },
      { category: 'arrival', body: 'Password for guest Wi-Fi: summerhouse' },
      { category: 'rules', body: 'WLAN-Passwort für Gäste: ferienhaus' },
      { category: 'local_tips', body: 'Geslo za Wi-Fi: poletje' },
    ];
    const sectionIds: string[] = [];
    for (const [index, entry] of cases.entries()) {
      const sectionId = await createSection(host, propertyId, entry.category);
      await saveSection(host, {
        propertyId,
        sectionId,
        category: entry.category,
        title: `Synthetic credential ${index + 1}`,
        body: entry.body,
        visibility: 'guest',
        secretValue: '',
        published: true,
      });
      sectionIds.push(sectionId);
    }
    await publishProperty(host, propertyId);

    credentialState.active = credentials;
    const blocked = await generateTranslations({ propertyId, actorId: host.userId });
    expect(blocked).toEqual({ state: 'blocked', sectionIds });
    // Zero OAuth and translate requests: the scanner stops generation before the provider client.
    expect(requests).toHaveLength(0);
    expect(await admin`select id from app.guide_translations where section_id in ${sql(sectionIds)}`).toHaveLength(0);
    expect(
      await admin`select id from app.audit_events where actor_id = ${host.userId} and action = 'translation_generated'`,
    ).toHaveLength(0);
  }, 60_000);

  it('fails closed on provider errors and never stores a partial generation', async () => {
    const host = await newHost('translation-failures');
    credentialState.active = credentials;

    async function cleanProperty(): Promise<string> {
      const propertyId = await createProperty(host, ['de', 'sl']);
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
      return propertyId;
    }

    for (const mode of [
      { kind: 'translate_error' } as const,
      { kind: 'count_mismatch' } as const,
      { kind: 'empty_text' } as const,
      { kind: 'control_text' } as const,
      { kind: 'long_title' } as const,
    ]) {
      providerMode = mode;
      const propertyId = await cleanProperty();
      expect(await generateTranslations({ propertyId, actorId: host.userId })).toEqual({
        state: 'provider_unavailable',
      });
      expect(
        await admin`select t.id from app.guide_translations t
        join app.guide_sections s on s.id = t.section_id where s.property_id = ${propertyId}`,
      ).toHaveLength(0);
    }

    providerMode = { kind: 'fail_sl' };
    const partial = await cleanProperty();
    expect(await generateTranslations({ propertyId: partial, actorId: host.userId })).toEqual({
      state: 'provider_unavailable',
    });
    expect(
      await admin`select t.id from app.guide_translations t
      join app.guide_sections s on s.id = t.section_id where s.property_id = ${partial}`,
    ).toHaveLength(0);
    expect(
      await admin`select id from app.audit_events where actor_id = ${host.userId} and action = 'translation_generated'`,
    ).toHaveLength(0);

    // A 401 drops the cached token, so the next generation signs in again.
    providerMode = { kind: 'unauthorized' };
    expect(await generateTranslations({ propertyId: await cleanProperty(), actorId: host.userId })).toEqual({
      state: 'provider_unavailable',
    });
    providerMode = { kind: 'ok' };
    requests.length = 0;
    const recovered = await cleanProperty();
    expect((await generateTranslations({ propertyId: recovered, actorId: host.userId })).state).toBe('generated');
    expect(requests.filter((request) => request.url === TOKEN_URL)).toHaveLength(1);
  }, 60_000);

  it('reports provider_unavailable without credentials and performs no egress', async () => {
    const host = await newHost('translation-unconfigured');
    const propertyId = await createProperty(host, ['de']);
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

    credentialState.active = null;
    expect(await generateTranslations({ propertyId, actorId: host.userId })).toEqual({
      state: 'provider_unavailable',
    });
    expect(requests).toHaveLength(0);

    const http = decode<{ state?: string }>(
      await translationFn('generateGuideTranslations', { jar: host.jar, data: { propertyId } }),
    )?.result;
    expect(http?.state).toBe('provider_unavailable');
    expect(requests).toHaveLength(0);
  }, 60_000);

  it('keeps the selected guest language across tabs and current-language links, including a German source', async () => {
    const host = await newHost('translation-navigation');
    const propertyId = await createProperty(host, ['de', 'sl']);
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
    await publishProperty(host, propertyId);
    const link = newShareLink();
    const issued = await withOwnerContext(host.userId, (tx) =>
      insertShareLink(tx, { propertyId, id: link.id, hmac: link.hmac }),
    );
    if (!issued) throw new Error('synthetic link issuance failed');
    const token = await exchangeGuestLink({ shareId: link.id, secret: link.secret });
    if (!token) throw new Error('synthetic guest exchange failed');
    const cookie = serializeGuestCookie(token, false).split(';')[0]!;
    const shareId = link.id;
    const callsBefore = requests.length;

    const page = async (path: string) => {
      const response = await fetch(`${APP}${path}`, { headers: { cookie } });
      expect(response.status).toBe(200);
      return response.text();
    };
    const navHrefs = (html: string) => {
      const nav = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
      return [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!);
    };
    const localeHrefs = (html: string) => {
      const entries: Record<string, string> = {};
      for (const code of ['en', 'de', 'sl']) {
        const href = html.match(new RegExp(`href="([^"]*)"[^>]*data-testid="guest-locale-${code}"`))?.[1];
        if (href) entries[code] = href;
      }
      return entries;
    };
    const mainLang = (html: string) => html.match(/<main[^>]*lang="([a-z]{2})"/)?.[1];

    const englishHome = await page(`/g/${shareId}`);
    expect(mainLang(englishHome)).toBe('en');
    expect(navHrefs(englishHome)).toEqual([`/g/${shareId}`, `/g/${shareId}/guide`, `/g/${shareId}/help`]);
    expect(localeHrefs(englishHome)).toEqual({
      en: `/g/${shareId}`,
      de: `/g/${shareId}?lang=de`,
      sl: `/g/${shareId}?lang=sl`,
    });

    const germanGuide = await page(`/g/${shareId}/guide?lang=de`);
    expect(mainLang(germanGuide)).toBe('de');
    expect(navHrefs(germanGuide)).toEqual([
      `/g/${shareId}?lang=de`,
      `/g/${shareId}/guide?lang=de`,
      `/g/${shareId}/help?lang=de`,
    ]);
    expect(localeHrefs(germanGuide)).toEqual({
      de: `/g/${shareId}/guide?lang=de`,
      en: `/g/${shareId}/guide`,
      sl: `/g/${shareId}/guide?lang=sl`,
    });

    // Follow the advertised anchors; every hop keeps the selected language until the source is chosen.
    for (const href of navHrefs(germanGuide)) expect(mainLang(await page(href))).toBe('de');
    const slovenianHelp = await page(localeHrefs(germanGuide).sl);
    expect(mainLang(slovenianHelp)).toBe('sl');
    for (const href of navHrefs(slovenianHelp)) expect(mainLang(await page(href))).toBe('sl');
    const sourceGuide = await page(localeHrefs(germanGuide).en);
    expect(mainLang(sourceGuide)).toBe('en');
    expect(navHrefs(sourceGuide)).toEqual([`/g/${shareId}`, `/g/${shareId}/guide`, `/g/${shareId}/help`]);
    for (const href of navHrefs(sourceGuide)) expect(mainLang(await page(href))).toBe('en');

    const switched = decode<{ ok?: boolean }>(
      await guideFn('saveProperty', {
        jar: host.jar,
        data: {
          propertyId,
          displayName: 'Synthetic translation villa',
          sourceLocale: 'de',
          enabledLocales: ['en', 'sl'],
        },
      }),
    )?.result;
    expect(switched?.ok).toBe(true);

    const germanSourceHome = await page(`/g/${shareId}`);
    expect(mainLang(germanSourceHome)).toBe('de');
    expect(navHrefs(germanSourceHome)).toEqual([`/g/${shareId}`, `/g/${shareId}/guide`, `/g/${shareId}/help`]);
    expect(localeHrefs(germanSourceHome)).toEqual({
      de: `/g/${shareId}`,
      en: `/g/${shareId}?lang=en`,
      sl: `/g/${shareId}?lang=sl`,
    });

    const englishGuide = await page(`/g/${shareId}/guide?lang=en`);
    expect(mainLang(englishGuide)).toBe('en');
    expect(navHrefs(englishGuide)).toEqual([
      `/g/${shareId}?lang=en`,
      `/g/${shareId}/guide?lang=en`,
      `/g/${shareId}/help?lang=en`,
    ]);
    expect(localeHrefs(englishGuide)).toEqual({
      de: `/g/${shareId}/guide`,
      en: `/g/${shareId}/guide?lang=en`,
      sl: `/g/${shareId}/guide?lang=sl`,
    });
    for (const href of navHrefs(englishGuide)) expect(mainLang(await page(href))).toBe('en');

    // Full-document guest reads never call the provider path.
    expect(requests.length).toBe(callsBefore);
  }, 60_000);
});
