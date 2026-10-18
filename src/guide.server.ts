import type postgres from 'postgres';
import { z } from 'zod';
import {
  copyPropertyInput,
  createSectionInput,
  moveSectionInput,
  propertyFields,
  savePropertyInput,
  saveSectionInput,
  setGuidePublishedInput,
  type SectionCategory,
  type SectionVisibility,
} from './guide-validation';

// Canonical guide write/read layer for any trusted caller (host server functions now, the token
// API and PMS workers later): call it inside withOwnerContext; RLS enforces ownership and the
// transaction-local owner is the only identity used for inserts.

export type GuideEditorData = {
  property: { id: string; displayName: string; sourceLocale: string; published: boolean };
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
  }[];
};

export type GuestGuideDto = {
  displayName: string;
  sourceLocale: string;
  sections: { category: SectionCategory; title: string; body: string }[];
};

export type GuestGuideRow = {
  category: string;
  title: string;
  body: string;
  visibility: string;
  published: boolean;
  display_order: number;
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
};

// Explicit allowlist for everything guests receive: published guest prose in display order; host
// notes, drafts, and secret values are dropped even if a caller passes rows that carry them.
export function toGuestGuideDto(
  property: { display_name: string; source_locale: string },
  rows: GuestGuideRow[],
): GuestGuideDto {
  return {
    displayName: property.display_name,
    sourceLocale: property.source_locale,
    sections: rows
      .filter((row) => row.published && row.visibility === 'guest')
      .sort((a, b) => a.display_order - b.display_order)
      .map((row) => ({ category: row.category as SectionCategory, title: row.title, body: row.body })),
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
  const [property] = await tx<{ id: string; display_name: string; source_locale: string; published: boolean }[]>`
    select id, display_name, source_locale, published from app.properties where id = ${propertyId}
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
  return {
    property: {
      id: property.id,
      displayName: property.display_name,
      sourceLocale: property.source_locale,
      published: property.published,
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
    })),
  };
}

export async function readGuestGuide(
  tx: postgres.TransactionSql,
  propertyId: string,
): Promise<{ guest: GuestGuideDto; guidePublished: boolean } | null> {
  const [property] = await tx<{ display_name: string; source_locale: string; published: boolean }[]>`
    select display_name, source_locale, published from app.properties where id = ${propertyId}
  `;
  if (!property) return null;
  // The query already restricts to guest-published rows; toGuestGuideDto allowlists again.
  const rows = await tx<GuestGuideRow[]>`
    select category, title, body, visibility, published, display_order
    from app.guide_sections
    where property_id = ${propertyId} and published and visibility = 'guest'
    order by display_order, created_at, id
  `;
  return { guest: toGuestGuideDto(property, rows), guidePublished: property.published };
}

// Canonical writes validate with the shared schemas; HTTP handlers parse first only to surface
// field-level errors, so direct callers cannot store input the HTTP boundary would reject.
function canonicalInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('invalid_input');
  return parsed.data;
}

export async function insertProperty(
  tx: postgres.TransactionSql,
  input: { displayName: string; sourceLocale: string },
): Promise<string> {
  const parsed = canonicalInput(propertyFields, input);
  const [row] = await tx<{ id: string }[]>`
    insert into app.properties (owner_id, display_name, source_locale)
    values (app.current_owner_id(), ${parsed.displayName}, ${parsed.sourceLocale})
    returning id
  `;
  return row.id;
}

export async function updateProperty(
  tx: postgres.TransactionSql,
  input: { propertyId: string; displayName: string; sourceLocale: string },
): Promise<boolean> {
  const parsed = canonicalInput(savePropertyInput, input);
  const rows = await tx`
    update app.properties
    set display_name = ${parsed.displayName}, source_locale = ${parsed.sourceLocale}, updated_at = now()
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
    insert into app.properties (owner_id, display_name, source_locale, timezone)
    select owner_id, ${name}, source_locale, timezone from app.properties where id = ${parsed.sourcePropertyId}
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

export async function updateSection(tx: postgres.TransactionSql, input: SectionWrite): Promise<boolean> {
  const parsed = canonicalInput(saveSectionInput, input);
  const rows = await tx`
    update app.guide_sections set
      category = ${parsed.category},
      title = ${parsed.title},
      body = ${parsed.body},
      visibility = ${parsed.visibility},
      secret_value = case when ${parsed.visibility} = 'host' then ${parsed.secretValue === '' ? null : parsed.secretValue} else null end,
      published = case when ${parsed.visibility} = 'host' then published else ${parsed.published} end,
      source_revision = source_revision
        + case when visibility = 'guest' and (title is distinct from ${parsed.title} or body is distinct from ${parsed.body}) then 1 else 0 end,
      updated_at = now()
    where id = ${parsed.sectionId} and property_id = ${parsed.propertyId}
    returning id
  `;
  return rows.length === 1;
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
