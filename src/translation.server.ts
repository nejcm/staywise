import { createSign } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import { canonicalInput } from './canonical-input.server';
import { insertAudit } from './audit.server';
import { withOwnerContext } from './db.server';
import { serverEnv, type GoogleTranslateCredentials } from './env.server';
import { logEvent } from './log.server';
import {
  approveTranslationInput,
  hasControlCharacters,
  guestLocaleSchema,
  type GuestLocale,
  propertyIdInput,
  translatedBodySchema,
  translatedTitleSchema,
  translationInput,
} from './guide-validation';

// The single module that owns translation egress. The approved provider is Google Cloud
// Translation - Advanced through the EU multi-regional endpoint; only eligible guest prose from
// this file's payload builder leaves the app, and only when credentials are configured.

const translateEndpoint = 'https://translate-eu.googleapis.com';
const translateLocation = 'europe-west1';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const translateScope = 'https://www.googleapis.com/auth/cloud-translation';
const providerName = 'google-translate-advanced';
const providerTimeoutMs = 15_000;
const maxChunkCharacters = 20_000;

let cachedToken: { value: string; expiresAt: number } | null = null;

type TranslationJobItem = {
  sectionId: string;
  locale: GuestLocale;
  title: string;
  body: string;
  sourceRevision: number;
};

export type GenerateOutcome =
  | { state: 'invalid_input' }
  | { state: 'nothing_to_do' }
  | { state: 'generated'; generated: number; skipped: number }
  | { state: 'blocked'; sectionIds: string[] }
  | { state: 'provider_unavailable' };

// Heuristics for secret-like and contact-like prose. They catch common mistakes before egress and
// never prove absence, so the eligible payload stays a narrow allowlist of translated fields.
const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const phonePattern = /\+?\d[\d\s()./-]{6,}\d/g;
// Explicit credential labels in the three supported languages; the Wi-Fi compounds cover the
// shorthand "wifi pass" forms the earlier keyword list caught.
const credentialLabels = [
  'passw\\w*',
  'passcod\\w*',
  'pincod\\w*',
  'pin',
  '(?:access|door|lock|gate|alarm|entry)\\s+cod\\w*',
  '(?:wi-?fi|wlan)\\s*[- ]\\s*pass\\w*',
  '(?:zugangs|zutritts|eingangs|haustür|haustuer|tür|tuer|alarm)-?cod\\w*',
  'ges(?:la|lo)',
  'vstopn\\w*\\s+kod\\w*',
  'dostopn\\w*\\s+kod\\w*',
  'koda\\s+za\\s+(?:vrata|vhod|alarm)',
].join('|');
const credentialLabel = new RegExp(`\\b(?:${credentialLabels})\\b`, 'giu');
// A labelled assignment such as "Wi-Fi password: summerhouse", "Password for guest Wi-Fi:
// summerhouse", "WLAN-Passwort für Gäste: ferienhaus" or "Geslo za Wi-Fi: poletje" is treated as a
// secret whatever the value looks like. Up to four qualifier words may sit between the label and
// the separator; sentence punctuation ends the window. The composition heuristic below still
// catches prose forms without an assignment, such as "The door code is BLUEBIRD.".
const credentialAssignment = new RegExp(
  `\\b(?:${credentialLabels})\\b(?:\\s+[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*){0,4}\\s*[:=]\\s*\\S`,
  'iu',
);

function keywordSecret(text: string): boolean {
  for (const match of text.matchAll(credentialLabel)) {
    const rest = text.slice(match.index + match[0].length, match.index + match[0].length + 24);
    for (const token of rest.split(/[^A-Za-z0-9]+/)) {
      if (token.length < 3) continue;
      const digits = token.replace(/\D/g, '').length;
      if (digits >= 2 || (token.length >= 4 && token === token.toUpperCase())) return true;
    }
  }
  return false;
}

function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const probability = count / text.length;
    bits -= probability * Math.log2(probability);
  }
  return bits;
}

function highEntropyToken(text: string): boolean {
  for (const token of text.split(/\s+/)) {
    if (token.startsWith('http://') || token.startsWith('https://') || token.includes('@')) continue;
    if (token.length < 16 || token.length > 200) continue;
    const hasDigit = /\d/.test(token);
    const hasUpper = /[A-Z]/.test(token);
    const hasLower = /[a-z]/.test(token);
    if (/^[0-9a-f]{16,}$/i.test(token) && hasDigit) return true;
    if (/^[A-Za-z0-9_-]{16,}$/.test(token) && hasDigit && hasUpper && hasLower) return true;
    if (token.length >= 24 && hasDigit && hasUpper && hasLower && entropy(token) >= 3.5) return true;
  }
  return false;
}

export function scanEgressText(text: string): 'contact' | 'secret' | null {
  if (emailPattern.test(text)) return 'contact';
  for (const candidate of text.matchAll(phonePattern)) {
    if (candidate[0].replace(/\D/g, '').length >= 8) return 'contact';
  }
  if (credentialAssignment.test(text) || keywordSecret(text) || highEntropyToken(text)) return 'secret';
  return null;
}

// Exact request shape sent to the provider; tests assert this serialization contains no marker
// value that the eligibility rules exclude.
export function buildTranslationRequest(contents: string[], sourceLocale: string, targetLocale: string) {
  return {
    contents,
    mimeType: 'text/plain',
    sourceLanguageCode: sourceLocale,
    targetLanguageCode: targetLocale,
  };
}

function signedAssertion(credentials: GoogleTranslateCredentials): string {
  const issued = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: translateScope,
      aud: tokenUrl,
      iat: issued,
      exp: issued + 3600,
    }),
  ).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(credentials.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

async function accessToken(credentials: GoogleTranslateCredentials): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(credentials),
    }).toString(),
    signal: AbortSignal.timeout(providerTimeoutMs),
  });
  if (!response.ok) throw new Error('provider_token_failed');
  const parsed = z
    .object({ access_token: z.string().min(1), expires_in: z.number().positive() })
    .safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error('provider_token_invalid');
  cachedToken = { value: parsed.data.access_token, expiresAt: Date.now() + parsed.data.expires_in * 1000 };
  return cachedToken.value;
}

function chunks(contents: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const content of contents) {
    if (current.length > 0 && size + content.length > maxChunkCharacters) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(content);
    size += content.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Provider output is untrusted: fixed count, non-empty, bounded, control-free, else the whole
// generation fails and nothing is stored.
async function translateContents(
  credentials: GoogleTranslateCredentials,
  contents: string[],
  sourceLocale: string,
  targetLocale: string,
): Promise<string[]> {
  const token = await accessToken(credentials);
  const url = `${translateEndpoint}/v3/projects/${credentials.projectId}/locations/${translateLocation}:translateText`;
  const responseSchema = z.object({ translations: z.array(z.object({ translatedText: z.string() })) });
  const translated: string[] = [];
  for (const chunk of chunks(contents)) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildTranslationRequest(chunk, sourceLocale, targetLocale)),
      signal: AbortSignal.timeout(providerTimeoutMs),
    });
    if (!response.ok) throw new Error('provider_http_error');
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || parsed.data.translations.length !== chunk.length)
      throw new Error('provider_response_invalid');
    for (const entry of parsed.data.translations) {
      const text = entry.translatedText.trim();
      if (text === '' || text.length > 16_000 || hasControlCharacters(text)) {
        throw new Error('provider_response_invalid');
      }
      translated.push(text);
    }
  }
  return translated;
}

// Eligible work for the current source revision: published guest prose with no translation that
// is already current for an enabled locale.
async function readTranslationJob(
  tx: postgres.TransactionSql,
  propertyId: string,
): Promise<{ sourceLocale: string; items: TranslationJobItem[]; skipped: number } | null> {
  const parsed = canonicalInput(propertyIdInput, { propertyId });
  const [property] = await tx<{ source_locale: string; enabled_locales: string[] }[]>`
    select source_locale, enabled_locales from app.properties where id = ${parsed.propertyId}
  `;
  if (!property) return null;
  const targets = property.enabled_locales.filter((locale) => locale !== property.source_locale);
  if (targets.length === 0) return { sourceLocale: property.source_locale, items: [], skipped: 0 };
  const sections = await tx<{ id: string; title: string; body: string; source_revision: number }[]>`
    select id, title, body, source_revision from app.guide_sections
    where property_id = ${parsed.propertyId} and published and visibility = 'guest'
    order by display_order, created_at, id
  `;
  const current = await tx<{ section_id: string; locale: string }[]>`
    select t.section_id, t.locale from app.guide_translations t
    join app.guide_sections s on s.id = t.section_id
    where s.property_id = ${parsed.propertyId}
      and t.locale = any(${targets})
      and t.source_revision = s.source_revision
      and t.source_locale = ${property.source_locale}
  `;
  const covered = new Set(current.map((row) => `${row.section_id}:${row.locale}`));
  const items: TranslationJobItem[] = [];
  let skipped = 0;
  for (const section of sections) {
    if (section.title.trim() === '' || section.body.trim() === '') continue;
    for (const locale of targets) {
      if (covered.has(`${section.id}:${locale}`)) {
        skipped += 1;
        continue;
      }
      items.push({
        sectionId: section.id,
        locale: locale as GuestLocale,
        title: section.title,
        body: section.body,
        sourceRevision: section.source_revision,
      });
    }
  }
  return { sourceLocale: property.source_locale, items, skipped };
}

const storedDraftSchema = z.object({
  sectionId: z.uuid(),
  locale: guestLocaleSchema,
  title: translatedTitleSchema,
  body: translatedBodySchema,
  sourceRevision: z.number().int().positive(),
});
const storeTranslationsInput = z.object({
  propertyId: z.uuid(),
  sourceLocale: guestLocaleSchema,
  drafts: z.array(storedDraftSchema).max(1000),
});

type StoredTranslation = z.infer<typeof storedDraftSchema>;

// Drafts land as one transaction per generation. A row that is already current at store time is
// never overwritten (the candidate check repeats here), so a host reviewing a draft keeps it.
async function storeTranslations(
  tx: postgres.TransactionSql,
  input: { propertyId: string; sourceLocale: string; drafts: StoredTranslation[] },
): Promise<number> {
  const parsed = canonicalInput(storeTranslationsInput, input);
  if (parsed.drafts.length === 0) return 0;
  // Property row lock: generation serializes with other ordered per-property writes.
  const locked = await tx`select id from app.properties where id = ${parsed.propertyId} for update`;
  if (locked.length !== 1) return 0;
  let stored = 0;
  for (const draft of parsed.drafts) {
    const rows = await tx`
      insert into app.guide_translations (section_id, locale, title, body, source_revision, source_locale, state, provider)
      select s.id, ${draft.locale}, ${draft.title}, ${draft.body}, ${draft.sourceRevision}, ${parsed.sourceLocale}, 'draft', ${providerName}
      from app.guide_sections s
      join app.properties p on p.id = s.property_id
      where s.id = ${draft.sectionId} and s.property_id = ${parsed.propertyId}
        and s.visibility = 'guest' and s.published
        and not exists (
          select 1 from app.guide_translations t
          where t.section_id = s.id and t.locale = ${draft.locale}
            and t.source_revision = s.source_revision and t.source_locale = p.source_locale
        )
      on conflict (section_id, locale) do update set
        title = excluded.title, body = excluded.body, source_revision = excluded.source_revision,
        source_locale = excluded.source_locale, state = 'draft', provider = excluded.provider, reviewed_at = null
      returning id
    `;
    stored += rows.length;
  }
  return stored;
}

// Explicit host action: read the job, block suspicious prose before any egress, translate changed
// eligible items per enabled locale, then store drafts with their audit row in one transaction.
// The stored drafts keep the revision observed before egress; a source edit meanwhile makes them
// stale instead of wrong.
export async function generateTranslations(input: { propertyId: string; actorId: string }): Promise<GenerateOutcome> {
  const job = await withOwnerContext(input.actorId, (tx) => readTranslationJob(tx, input.propertyId));
  if (!job) return { state: 'invalid_input' };
  if (job.items.length === 0) {
    return job.skipped > 0 ? { state: 'generated', generated: 0, skipped: job.skipped } : { state: 'nothing_to_do' };
  }
  const blocked = new Set<string>();
  for (const item of job.items) {
    if (scanEgressText(`${item.title}\n${item.body}`) !== null) blocked.add(item.sectionId);
  }
  if (blocked.size > 0) return { state: 'blocked', sectionIds: [...blocked] };

  const credentials = serverEnv.googleTranslateServiceAccount;
  if (!credentials) return { state: 'provider_unavailable' };

  const byLocale = new Map<GuestLocale, TranslationJobItem[]>();
  for (const item of job.items) byLocale.set(item.locale, [...(byLocale.get(item.locale) ?? []), item]);
  const drafts: StoredTranslation[] = [];
  try {
    for (const [locale, items] of byLocale) {
      const contents = items.flatMap((item) => [item.title, item.body]);
      const translated = await translateContents(credentials, contents, job.sourceLocale, locale);
      items.forEach((item, index) => {
        drafts.push({
          sectionId: item.sectionId,
          locale,
          title: translated[index * 2]!,
          body: translated[index * 2 + 1]!,
          sourceRevision: item.sourceRevision,
        });
      });
    }
  } catch {
    // Safe fields only: no payload, no locale text, no provider body.
    logEvent('translation_provider_failed', { appEnv: serverEnv.appEnv, status: 502, outcome: 'failed' });
    return { state: 'provider_unavailable' };
  }
  const generated = await withOwnerContext(input.actorId, async (tx) => {
    const stored = await storeTranslations(tx, {
      propertyId: input.propertyId,
      sourceLocale: job.sourceLocale,
      drafts,
    });
    if (stored > 0) await insertAudit(tx, input.actorId, 'translation_generated');
    return stored;
  });
  return { state: 'generated', generated, skipped: job.skipped };
}

// Approval is only possible while the draft still matches the live source revision and source
// language, and the revision the host reviewed, since regeneration reuses the row id.
export async function approveTranslation(
  tx: postgres.TransactionSql,
  input: { propertyId: string; translationId: string; sourceRevision: number; title: string; body: string },
): Promise<boolean> {
  const parsed = canonicalInput(approveTranslationInput, input);
  const rows = await tx`
    update app.guide_translations t
    set title = ${parsed.title}, body = ${parsed.body}, state = 'approved', reviewed_at = now()
    from app.guide_sections s, app.properties p
    where t.id = ${parsed.translationId} and t.section_id = s.id and s.property_id = ${parsed.propertyId}
      and p.id = s.property_id and t.state = 'draft' and t.source_revision = ${parsed.sourceRevision}
      and t.source_revision = s.source_revision and t.source_locale = p.source_locale
    returning t.id
  `;
  return rows.length === 1;
}

export async function rejectTranslation(
  tx: postgres.TransactionSql,
  input: { propertyId: string; translationId: string },
): Promise<boolean> {
  const parsed = canonicalInput(translationInput, input);
  const rows = await tx`
    delete from app.guide_translations t
    using app.guide_sections s
    where t.id = ${parsed.translationId} and t.state = 'draft'
      and t.section_id = s.id and s.property_id = ${parsed.propertyId}
    returning t.id
  `;
  return rows.length === 1;
}
