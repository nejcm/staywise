import type postgres from 'postgres';
import type { z } from 'zod';
import { canonicalInput } from '../../lib/canonical-input.server';
import {
  alertEmailSchema,
  copyPropertyInput,
  createPropertyInput,
  createSectionInput,
  heroAltSchema,
  heroWriteInput,
  moveSectionInput,
  propertyIdInput,
  savePropertyInput,
  saveSectionInput,
  setGuidePublishedInput,
  type GuestTheme,
  type SectionCategory,
  type SectionVisibility,
  isTimeZone,
  timeZones,
} from './guide-validation';
import { builtInHostSettings, readHostSettings } from '../host/settings.server';

// Canonical guide write/read layer for any trusted caller (host server functions now, the token
// API and PMS workers later): call it inside withOwnerContext; RLS enforces ownership and the
// transaction-local owner is the only identity used for inserts.

export type GuideTranslation = {
  id: string;
  locale: string;
  title: string;
  body: string;
  state: 'draft' | 'approved';
  sourceRevision: number;
  stale: boolean;
  reviewedAt: string | null;
};

// Object paths never leave the server; version changes with every upload so URLs can be cached.
export type HeroImage = { alt: string; width: number; height: number; version: string };

export type GuideEditorData = {
  hero: HeroImage | null;
  property: {
    id: string;
    displayName: string;
    sourceLocale: string;
    enabledLocales: string[];
    published: boolean;
    alertEmail: string | null;
    theme: GuestTheme;
  } & PropertyEssentials;
  timeZones: string[];
  sections: {
    id: string;
    category: SectionCategory;
    title: string;
    body: string;
    visibility: SectionVisibility;
    secretValue: string | null;
    displayOrder: number;
    sourceRevision: number;
    published: boolean;
    translations: GuideTranslation[];
  }[];
};

// Host-only until guest phase 4b; times are HH:MM in the property's local time.
export type PropertyEssentials = {
  wifiName: string | null;
  wifiPassword: string | null;
  keyboxCode: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  address: string | null;
  contactPhone: string | null;
  answerFrom: string | null;
  answerTo: string | null;
  timezone: string;
};

type GuestProvenance = 'source' | 'reviewed' | 'fallback';

export type GuestGuideDto = {
  displayName: string;
  sourceLocale: string;
  locale: string;
  locales: string[];
  theme: GuestTheme;
  hero: HeroImage | null;
  sections: { category: SectionCategory; title: string; body: string; provenance: GuestProvenance }[];
};

export type GuestGuideRow = {
  id: string;
  category: string;
  title: string;
  body: string;
  visibility: string;
  published: boolean;
  display_order: number;
  translated_title?: string | null;
  translated_body?: string | null;
};

export type SectionWrite = {
  propertyId: string;
  sectionId: string;
  category: SectionCategory;
  title: string;
  body: string;
  visibility: SectionVisibility;
  secretValue: string;
  published: boolean;
  expectedRevision?: number;
};

// Explicit allowlist for everything guests receive: published guest prose in display order; host
// notes, drafts, and secret values are dropped even if a caller passes rows that carry them.
// A translated title/body is used only for a non-source locale; otherwise the row falls back to
// the source text and marked 'fallback' so the page can label it. The locale is normalized
// against the property's available locales here, so a caller cannot request an unapproved one.
export function toGuestGuideDto(
  property: { display_name: string; source_locale: string; enabled_locales: string[]; theme: string },
  rows: GuestGuideRow[],
  locale: string,
  hero: HeroImage | null = null,
): GuestGuideDto {
  const sourceLocale = property.source_locale;
  const locales = [...new Set([sourceLocale, ...property.enabled_locales])].sort();
  const served = locales.includes(locale) ? locale : sourceLocale;
  return {
    displayName: property.display_name,
    sourceLocale,
    locale: served,
    locales,
    theme: property.theme as GuestTheme,
    hero,
    sections: rows
      .filter((row) => row.published && row.visibility === 'guest')
      .sort((a, b) => a.display_order - b.display_order)
      .map((row) => {
        const translated = served !== sourceLocale && row.translated_title != null && row.translated_body != null;
        return translated
          ? {
              category: row.category as SectionCategory,
              title: row.translated_title!,
              body: row.translated_body!,
              provenance: 'reviewed',
            }
          : {
              category: row.category as SectionCategory,
              title: row.title,
              body: row.body,
              provenance: served === sourceLocale ? 'source' : 'fallback',
            };
      }),
  };
}

export async function ownsProperty(tx: postgres.TransactionSql, propertyId: string): Promise<boolean> {
  const rows = await tx`select 1 from app.properties where id = ${propertyId}`;
  return rows.length === 1;
}

type HeroRow = { alt: string; width: number; height: number; created_at: Date };

export function toHeroImage(row: HeroRow): HeroImage {
  return { alt: row.alt, width: row.width, height: row.height, version: String(row.created_at.getTime()) };
}

// RLS picks the owner or the live guest link view, so the same read serves editor, preview, and guide.
async function readHero(tx: postgres.TransactionSql, propertyId: string): Promise<HeroImage | null> {
  const [row] = await tx<HeroRow[]>`
    select alt, width, height, created_at from app.property_images where property_id = ${propertyId}
  `;
  return row ? toHeroImage(row) : null;
}

export async function readHeroPath(tx: postgres.TransactionSql, propertyId: string): Promise<string | null> {
  const [row] = await tx<{ object_path: string }[]>`
    select object_path from app.property_images where property_id = ${propertyId}
  `;
  return row?.object_path ?? null;
}

export function heroObjectPath(propertyId: string): string {
  return `${canonicalInput(propertyIdInput, { propertyId }).propertyId}/${crypto.randomUUID()}.jpg`;
}

// The object is uploaded first under a fresh key; replacing the row queues the old object for the drain (ADR 0005).
export async function upsertHero(
  tx: postgres.TransactionSql,
  objectPath: string,
  input: { propertyId: string; alt: string; width: number; height: number; bytes: number },
): Promise<HeroImage | null> {
  const parsed = canonicalInput(heroWriteInput, input);
  if (!objectPath.startsWith(`${parsed.propertyId}/`)) throw new Error('invalid_input');
  if (!(await ownsProperty(tx, parsed.propertyId))) return null;
  const [row] = await tx<HeroRow[]>`
    insert into app.property_images (property_id, object_path, alt, width, height, bytes)
    values (${parsed.propertyId}, ${objectPath}, ${parsed.alt}, ${parsed.width}, ${parsed.height}, ${parsed.bytes})
    on conflict (property_id) do update set
      object_path = excluded.object_path, alt = excluded.alt, width = excluded.width,
      height = excluded.height, bytes = excluded.bytes, created_at = now()
    returning alt, width, height, created_at
  `;
  return row ? toHeroImage(row) : null;
}

export async function updateHeroAlt(tx: postgres.TransactionSql, propertyId: string, alt: string): Promise<boolean> {
  const parsed = canonicalInput(propertyIdInput, { propertyId });
  const text = canonicalInput(heroAltSchema, alt);
  const rows = await tx`
    update app.property_images set alt = ${text} where property_id = ${parsed.propertyId} returning property_id
  `;
  return rows.length === 1;
}

export async function deleteHero(tx: postgres.TransactionSql, propertyId: string): Promise<boolean> {
  const parsed = canonicalInput(propertyIdInput, { propertyId });
  const rows = await tx`delete from app.property_images where property_id = ${parsed.propertyId} returning property_id`;
  return rows.length === 1;
}

export async function readGuideEditor(
  tx: postgres.TransactionSql,
  propertyId: string,
): Promise<GuideEditorData | null> {
  const [property] = await tx<
    {
      id: string;
      display_name: string;
      source_locale: string;
      enabled_locales: string[];
      published: boolean;
      alert_email: string | null;
      theme: string;
    }[]
  >`
    select id, display_name, source_locale, enabled_locales, published, alert_email, theme
    from app.properties where id = ${propertyId}
  `;
  if (!property) return null;
  const essentials = await readPropertyEssentials(tx, propertyId);
  const sections = await tx<
    {
      id: string;
      category: string;
      title: string;
      body: string;
      visibility: string;
      secret_value: string | null;
      display_order: number;
      source_revision: number;
      published: boolean;
    }[]
  >`
    select id, category, title, body, visibility, secret_value, display_order, source_revision, published
    from app.guide_sections
    where property_id = ${propertyId}
    order by display_order, created_at, id
  `;
  const translations = await tx<
    {
      id: string;
      section_id: string;
      locale: string;
      title: string;
      body: string;
      state: string;
      source_revision: number;
      stale: boolean;
      reviewed_at: Date | null;
    }[]
  >`
    select t.id, t.section_id, t.locale, t.title, t.body, t.state, t.source_revision,
      (t.source_revision is distinct from s.source_revision or t.source_locale is distinct from p.source_locale) as stale,
      t.reviewed_at
    from app.guide_translations t
    join app.guide_sections s on s.id = t.section_id
    join app.properties p on p.id = s.property_id
    where s.property_id = ${propertyId}
    order by t.locale, t.created_at
  `;
  const bySection = new Map<string, GuideTranslation[]>();
  for (const row of translations) {
    const list = bySection.get(row.section_id) ?? [];
    list.push({
      id: row.id,
      locale: row.locale,
      title: row.title,
      body: row.body,
      state: row.state as 'draft' | 'approved',
      sourceRevision: row.source_revision,
      stale: row.stale,
      reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    });
    bySection.set(row.section_id, list);
  }
  return {
    hero: await readHero(tx, propertyId),
    property: {
      id: property.id,
      displayName: property.display_name,
      sourceLocale: property.source_locale,
      enabledLocales: property.enabled_locales,
      published: property.published,
      alertEmail: property.alert_email,
      theme: property.theme as GuestTheme,
      ...essentials,
    },
    sections: sections.map((section) => ({
      id: section.id,
      category: section.category as SectionCategory,
      title: section.title,
      body: section.body,
      visibility: section.visibility as SectionVisibility,
      secretValue: section.secret_value,
      displayOrder: section.display_order,
      sourceRevision: section.source_revision,
      published: section.published,
      translations: bySection.get(section.id) ?? [],
    })),
    timeZones,
  };
}

export async function readPropertyEssentials(
  tx: postgres.TransactionSql,
  propertyId: string,
): Promise<PropertyEssentials> {
  const [row] = await tx<
    {
      wifi_name: string | null;
      wifi_password: string | null;
      keybox_code: string | null;
      checkin_time: string | null;
      checkout_time: string | null;
      address: string | null;
      contact_phone: string | null;
      answer_from: string | null;
      answer_to: string | null;
      timezone: string;
    }[]
  >`
    select c.wifi_name, c.wifi_password, c.keybox_code, p.address, p.contact_phone, p.timezone,
      to_char(p.checkin_time, 'HH24:MI') as checkin_time, to_char(p.checkout_time, 'HH24:MI') as checkout_time,
      to_char(p.answer_from, 'HH24:MI') as answer_from, to_char(p.answer_to, 'HH24:MI') as answer_to
    from app.properties p
    left join app.property_credentials c on c.property_id = p.id
    where p.id = ${propertyId}
  `;
  return {
    wifiName: row?.wifi_name ?? null,
    wifiPassword: row?.wifi_password ?? null,
    keyboxCode: row?.keybox_code ?? null,
    checkinTime: row?.checkin_time ?? null,
    checkoutTime: row?.checkout_time ?? null,
    address: row?.address ?? null,
    contactPhone: row?.contact_phone ?? null,
    answerFrom: row?.answer_from ?? null,
    answerTo: row?.answer_to ?? null,
    timezone: row?.timezone ?? 'UTC',
  };
}

export async function readGuestGuide(
  tx: postgres.TransactionSql,
  propertyId: string,
  locale: string | null,
): Promise<{ guest: GuestGuideDto; guidePublished: boolean } | null> {
  const [property] = await tx<
    { display_name: string; source_locale: string; enabled_locales: string[]; published: boolean; theme: string }[]
  >`
    select display_name, source_locale, enabled_locales, published, theme from app.properties where id = ${propertyId}
  `;
  if (!property) return null;
  // Approved translations bound to the live revision and source language join in; anything else
  // stays null and the section is served in the source language as 'fallback'. The query
  // repeats the guest RLS conditions so the host preview shows exactly what guests would see.
  const rows = await tx<GuestGuideRow[]>`
    select s.id, s.category, s.title, s.body, s.visibility, s.published, s.display_order,
      t.title as translated_title, t.body as translated_body
    from app.guide_sections s
    left join app.guide_translations t
      on t.section_id = s.id
      and t.locale = ${locale}
      and t.state = 'approved'
      and t.source_revision = s.source_revision
      and t.source_locale = ${property.source_locale}
    where s.property_id = ${propertyId} and s.published and s.visibility = 'guest'
    order by s.display_order, s.created_at, s.id
  `;
  return {
    guest: toGuestGuideDto(property, rows, locale ?? property.source_locale, await readHero(tx, propertyId)),
    guidePublished: property.published,
  };
}

// Defaults come from the owner's host settings, read in this transaction, never from the caller.
// alertEmail carries the host's sign-in address for the minimal new-message alert; a value that is
// not a valid address is dropped rather than failing property creation.
export async function insertProperty(
  tx: postgres.TransactionSql,
  input: { displayName: string },
  alertEmail: string | null = null,
): Promise<string> {
  const parsed = canonicalInput(createPropertyInput, input);
  const parsedEmail = alertEmail ? alertEmailSchema.safeParse(alertEmail) : null;
  const email = parsedEmail?.success ? parsedEmail.data : null;
  const d = (await readHostSettings(tx)) ?? builtInHostSettings;
  const [row] = await tx<{ id: string }[]>`
    insert into app.properties (owner_id, display_name, source_locale, enabled_locales, timezone, theme, contact_phone,
      answer_from, answer_to, checkin_time, checkout_time, alert_email)
    values (app.current_owner_id(), ${parsed.displayName}, ${d.sourceLocale}, ${d.enabledLocales}, ${d.timezone},
      ${d.theme}, ${d.contactPhone}, ${d.answerFrom}, ${d.answerTo}, ${d.checkinTime}, ${d.checkoutTime}, ${email})
    returning id
  `;
  return row!.id;
}

export async function updateProperty(
  tx: postgres.TransactionSql,
  input: z.input<typeof savePropertyInput>,
): Promise<boolean> {
  const parsed = canonicalInput(savePropertyInput, input);
  if (parsed.timezone !== undefined && !isTimeZone(parsed.timezone)) {
    const [stored] = await tx<{ timezone: string }[]>`
      select timezone from app.properties where id = ${parsed.propertyId}
    `;
    if (stored?.timezone !== parsed.timezone) return false;
  }
  if ((parsed.answerFrom === undefined) !== (parsed.answerTo === undefined)) {
    const [stored] = await tx<{ answer_from: string | null; answer_to: string | null }[]>`
      select answer_from::text, answer_to::text from app.properties where id = ${parsed.propertyId}
    `;
    const from = parsed.answerFrom ?? stored?.answer_from ?? '';
    const to = parsed.answerTo ?? stored?.answer_to ?? '';
    if (!from !== !to) return false;
  }
  const keep = (value: string | undefined, column: string) => (value === undefined ? tx(column) : value || null);
  const rows = await tx`
    update app.properties
    set display_name = ${parsed.displayName}, source_locale = ${parsed.sourceLocale},
      enabled_locales = ${parsed.enabledLocales}, checkin_time = ${keep(parsed.checkinTime, 'checkin_time')},
      checkout_time = ${keep(parsed.checkoutTime, 'checkout_time')}, address = ${keep(parsed.address, 'address')},
      contact_phone = ${keep(parsed.contactPhone, 'contact_phone')}, answer_from = ${keep(parsed.answerFrom, 'answer_from')},
      answer_to = ${keep(parsed.answerTo, 'answer_to')},
      timezone = ${parsed.timezone ?? tx('timezone')}, theme = ${parsed.theme ?? tx('theme')}, updated_at = now()
    where id = ${parsed.propertyId}
    returning id
  `;
  if (rows.length !== 1) return false;
  const { wifiName, wifiPassword, keyboxCode } = parsed;
  if (wifiName === undefined && wifiPassword === undefined && keyboxCode === undefined) return true;
  await tx`
    insert into app.property_credentials as c (property_id, wifi_name, wifi_password, keybox_code)
    values (${parsed.propertyId}, ${wifiName || null}, ${wifiPassword || null}, ${keyboxCode || null})
    on conflict (property_id) do update set
      wifi_name = ${keep(wifiName, 'c.wifi_name')}, wifi_password = ${keep(wifiPassword, 'c.wifi_password')},
      keybox_code = ${keep(keyboxCode, 'c.keybox_code')}, updated_at = now()
  `;
  return true;
}

export async function setPropertyPublished(
  tx: postgres.TransactionSql,
  propertyId: string,
  published: boolean,
): Promise<boolean> {
  const parsed = canonicalInput(setGuidePublishedInput, { propertyId, published });
  const rows = await tx`
    update app.properties set published = ${parsed.published}, updated_at = now() where id = ${parsed.propertyId} returning id
  `;
  return rows.length === 1;
}

export async function deleteProperty(tx: postgres.TransactionSql, propertyId: string): Promise<boolean> {
  const parsed = canonicalInput(propertyIdInput, { propertyId });
  const rows = await tx`delete from app.properties where id = ${parsed.propertyId} returning id`;
  return rows.length === 1;
}

export async function updateAlertEmail(
  tx: postgres.TransactionSql,
  propertyId: string,
  alertEmail: string,
): Promise<boolean> {
  const parsed = canonicalInput(propertyIdInput, { propertyId });
  const email = alertEmailSchema.safeParse(alertEmail);
  if (!email.success) return false;
  const rows = await tx`
    update app.properties set alert_email = ${email.data}, updated_at = now()
    where id = ${parsed.propertyId} returning id
  `;
  return rows.length === 1;
}

// Independent copy: sections arrive as drafts and secret values, the Wi-Fi password and the key-box
// code are never duplicated, so a second property can never inherit the first one's credentials.
export async function insertCopy(tx: postgres.TransactionSql, sourcePropertyId: string): Promise<string | null> {
  const parsed = canonicalInput(copyPropertyInput, { sourcePropertyId });
  const [source] = await tx<{ display_name: string }[]>`
    select display_name from app.properties where id = ${parsed.sourcePropertyId}
  `;
  if (!source) return null;
  const name = `${source.display_name} (copy)`.slice(0, 120);
  const [created] = await tx<{ id: string }[]>`
    insert into app.properties (owner_id, display_name, source_locale, timezone, enabled_locales, alert_email, checkin_time, checkout_time, address,
      contact_phone, answer_from, answer_to, theme)
    select owner_id, ${name}, source_locale, timezone, enabled_locales, alert_email, checkin_time, checkout_time, address,
      contact_phone, answer_from, answer_to, theme
    from app.properties where id = ${parsed.sourcePropertyId}
    returning id
  `;
  if (!created) return null;
  await tx`
    insert into app.property_credentials (property_id, wifi_name)
    select ${created.id}, wifi_name from app.property_credentials
    where property_id = ${parsed.sourcePropertyId} and wifi_name is not null
  `;
  await tx`
    insert into app.guide_sections (property_id, category, title, body, visibility, display_order)
    select ${created.id}, category, title, body, visibility, display_order
    from app.guide_sections
    where property_id = ${parsed.sourcePropertyId}
    order by display_order, created_at, id
  `;
  return created.id;
}

export async function insertSection(
  tx: postgres.TransactionSql,
  input: { propertyId: string; category: SectionCategory },
): Promise<string | null> {
  const parsed = canonicalInput(createSectionInput, input);
  // Property row lock: serializes display-order allocation so concurrent creates cannot tie.
  const locked = await tx`select id from app.properties where id = ${parsed.propertyId} for update`;
  if (locked.length !== 1) return null;
  const [row] = await tx<{ id: string }[]>`
    insert into app.guide_sections (property_id, category, title, body, visibility, display_order)
    select ${parsed.propertyId}, ${parsed.category}, '', '', 'guest',
      (select coalesce(max(display_order), 0) + 1 from app.guide_sections where property_id = ${parsed.propertyId})
    returning id
  `;
  return row?.id ?? null;
}

// Returns the saved source revision, or null when the section is missing or changed since it loaded.
export async function updateSection(tx: postgres.TransactionSql, input: SectionWrite): Promise<number | null> {
  const parsed = canonicalInput(saveSectionInput, input);
  const rows = await tx<{ source_revision: number }[]>`
    update app.guide_sections set
      category = ${parsed.category},
      title = ${parsed.title},
      body = ${parsed.body},
      visibility = ${parsed.visibility},
      secret_value = case when ${parsed.visibility} = 'host' then ${parsed.secretValue === '' ? null : parsed.secretValue} else null end,
      published = case when ${parsed.visibility} = 'host' then published else ${parsed.published} end,
      source_revision = source_revision
        + case when (title, body, category, visibility)
            is distinct from (${parsed.title}, ${parsed.body}, ${parsed.category}, ${parsed.visibility}) then 1 else 0 end,
      updated_at = now()
    where id = ${parsed.sectionId} and property_id = ${parsed.propertyId}
      and (${parsed.expectedRevision ?? null}::int is null or source_revision = ${parsed.expectedRevision ?? null})
    returning source_revision
  `;
  return rows[0]?.source_revision ?? null;
}

export async function moveSection(
  tx: postgres.TransactionSql,
  input: { propertyId: string; sectionId: string; direction: 'up' | 'down' },
): Promise<boolean> {
  const parsed = canonicalInput(moveSectionInput, input);
  // Property row lock: serializes order changes with concurrent creators and movers.
  const locked = await tx`select id from app.properties where id = ${parsed.propertyId} for update`;
  if (locked.length !== 1) return false;
  const rows = await tx<{ id: string; display_order: number }[]>`
    select id, display_order from app.guide_sections
    where property_id = ${parsed.propertyId}
    order by display_order, created_at, id
  `;
  const index = rows.findIndex((row) => row.id === parsed.sectionId);
  if (index < 0) return false;
  const neighborIndex = parsed.direction === 'up' ? index - 1 : index + 1;
  const neighbor = rows[neighborIndex];
  if (!neighbor) return true;
  // Renumber to a dense sequence when ties or gaps would otherwise make the swap a no-op.
  if (!rows.every((row, position) => row.display_order === position + 1)) {
    for (const [position, row] of rows.entries()) {
      await tx`
        update app.guide_sections set display_order = ${position + 1}, updated_at = now()
        where id = ${row.id} and property_id = ${parsed.propertyId}
      `;
    }
  }
  await tx`
    update app.guide_sections set display_order = ${neighborIndex + 1}, updated_at = now()
    where id = ${parsed.sectionId} and property_id = ${parsed.propertyId}
  `;
  await tx`
    update app.guide_sections set display_order = ${index + 1}, updated_at = now()
    where id = ${neighbor.id} and property_id = ${parsed.propertyId}
  `;
  return true;
}
