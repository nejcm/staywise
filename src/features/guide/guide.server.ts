import type postgres from 'postgres';
import { canonicalInput } from '../../lib/canonical-input.server';
import {
  alertEmailSchema,
  copyPropertyInput,
  createSectionInput,
  moveSectionInput,
  propertyFields,
  propertyIdInput,
  savePropertyInput,
  saveSectionInput,
  setGuidePublishedInput,
  type SectionCategory,
  type SectionVisibility,
} from './guide-validation';

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

export type GuideEditorData = {
  property: {
    id: string;
    displayName: string;
    sourceLocale: string;
    enabledLocales: string[];
    published: boolean;
    alertEmail: string | null;
  };
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

export type GuestGuideDto = {
  displayName: string;
  sourceLocale: string;
  locale: string;
  locales: string[];
  sections: { category: SectionCategory; title: string; body: string; fallback: boolean }[];
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
// the source text and is flagged so the page can label the fallback. The locale is normalized
// against the property's available locales here, so a caller cannot request an unapproved one.
export function toGuestGuideDto(
  property: { display_name: string; source_locale: string; enabled_locales: string[] },
  rows: GuestGuideRow[],
  locale: string,
): GuestGuideDto {
  const sourceLocale = property.source_locale;
  const locales = [...new Set([sourceLocale, ...property.enabled_locales])].sort();
  const served = locales.includes(locale) ? locale : sourceLocale;
  return {
    displayName: property.display_name,
    sourceLocale,
    locale: served,
    locales,
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
              fallback: false,
            }
          : {
              category: row.category as SectionCategory,
              title: row.title,
              body: row.body,
              fallback: served !== sourceLocale,
            };
      }),
  };
}

export async function ownsProperty(tx: postgres.TransactionSql, propertyId: string): Promise<boolean> {
  const rows = await tx`select 1 from app.properties where id = ${propertyId}`;
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
    }[]
  >`
    select id, display_name, source_locale, enabled_locales, published, alert_email
    from app.properties where id = ${propertyId}
  `;
  if (!property) return null;
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
    property: {
      id: property.id,
      displayName: property.display_name,
      sourceLocale: property.source_locale,
      enabledLocales: property.enabled_locales,
      published: property.published,
      alertEmail: property.alert_email,
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
  };
}

export async function readGuestGuide(
  tx: postgres.TransactionSql,
  propertyId: string,
  locale: string | null,
): Promise<{ guest: GuestGuideDto; guidePublished: boolean } | null> {
  const [property] = await tx<
    { display_name: string; source_locale: string; enabled_locales: string[]; published: boolean }[]
  >`
    select display_name, source_locale, enabled_locales, published from app.properties where id = ${propertyId}
  `;
  if (!property) return null;
  // Approved translations bound to the live revision and source language join in; anything else
  // stays null and the section is served in the source language with a fallback flag. The query
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
    guest: toGuestGuideDto(property, rows, locale ?? property.source_locale),
    guidePublished: property.published,
  };
}

// alertEmail carries the host's sign-in address for the minimal new-message alert; a value that is
// not a valid address is dropped rather than failing property creation.
export async function insertProperty(
  tx: postgres.TransactionSql,
  input: { displayName: string; sourceLocale: string; enabledLocales: string[] },
  alertEmail: string | null = null,
): Promise<string> {
  const parsed = canonicalInput(propertyFields, input);
  const parsedEmail = alertEmail ? alertEmailSchema.safeParse(alertEmail) : null;
  const email = parsedEmail?.success ? parsedEmail.data : null;
  const [row] = await tx<{ id: string }[]>`
    insert into app.properties (owner_id, display_name, source_locale, enabled_locales, alert_email)
    values (app.current_owner_id(), ${parsed.displayName}, ${parsed.sourceLocale}, ${parsed.enabledLocales}, ${email})
    returning id
  `;
  return row.id;
}

export async function updateProperty(
  tx: postgres.TransactionSql,
  input: { propertyId: string; displayName: string; sourceLocale: string; enabledLocales: string[] },
): Promise<boolean> {
  const parsed = canonicalInput(savePropertyInput, input);
  const rows = await tx`
    update app.properties
    set display_name = ${parsed.displayName}, source_locale = ${parsed.sourceLocale},
      enabled_locales = ${parsed.enabledLocales}, updated_at = now()
    where id = ${parsed.propertyId}
    returning id
  `;
  return rows.length === 1;
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

// Independent copy: sections arrive as drafts and secret values are never duplicated, so a second
// property can never inherit the first one's credentials.
export async function insertCopy(tx: postgres.TransactionSql, sourcePropertyId: string): Promise<string | null> {
  const parsed = canonicalInput(copyPropertyInput, { sourcePropertyId });
  const [source] = await tx<{ display_name: string }[]>`
    select display_name from app.properties where id = ${parsed.sourcePropertyId}
  `;
  if (!source) return null;
  const name = `${source.display_name} (copy)`.slice(0, 120);
  const [created] = await tx<{ id: string }[]>`
    insert into app.properties (owner_id, display_name, source_locale, timezone, enabled_locales, alert_email)
    select owner_id, ${name}, source_locale, timezone, enabled_locales, alert_email
    from app.properties where id = ${parsed.sourcePropertyId}
    returning id
  `;
  if (!created) return null;
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
