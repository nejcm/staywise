import type postgres from 'postgres';
import { toHeroImage } from '../guide/guide.server';

// Owner context: RLS limits the rows to the signed-in host's properties.
export async function readOwnProperties(tx: postgres.TransactionSql) {
  const rows = await tx`
    select p.id, p.display_name, p.address, p.alert_email, p.published, p.source_locale, p.enabled_locales,
      greatest(p.updated_at, (select max(s.updated_at) from app.guide_sections s where s.property_id = p.id)) as edited_at,
      coalesce((select array_agg(distinct s.category) from app.guide_sections s where s.property_id = p.id), '{}') as categories,
      (select count(*) from app.guide_sections s
        where s.property_id = p.id and s.visibility = 'guest' and not s.published)::int as unpublished_sections,
      coalesce((select array_agg(l) from unnest(p.enabled_locales) l
        where not exists (
          select 1 from app.guide_sections s
          where s.property_id = p.id and s.visibility = 'guest' and s.published
            and not exists (
              select 1 from app.guide_translations t
              where t.section_id = s.id and t.locale = l and t.state = 'approved'
                and t.source_revision = s.source_revision and t.source_locale = p.source_locale)
        )), '{}') as reviewed_locales,
      (select k.created_at from app.share_links k where k.property_id = p.id and k.enabled and k.kind = 'property') as link_created_at,
      coalesce((select sum(c.guide_opens) from app.guest_counters c
        where c.property_id = p.id and c.day > current_date - 30), 0)::int as opens_30d,
      coalesce((select sum(c.submissions) from app.guest_counters c
        where c.property_id = p.id and c.day > current_date - 30), 0)::int as messages_30d,
      (select count(*) from app.guest_messages m where m.property_id = p.id and m.state = 'new')::int as waiting,
      i.alt as hero_alt, i.width as hero_width, i.height as hero_height, i.created_at as hero_created_at
    from app.properties p
    left join app.property_images i on i.property_id = p.id
    order by p.created_at desc
  `;
  return rows.map((row) => ({
    id: row.id as string,
    displayName: row.display_name as string,
    address: row.address as string | null,
    alertEmail: row.alert_email as string | null,
    published: row.published as boolean,
    editedAt: (row.edited_at as Date).toISOString(),
    sourceLocale: row.source_locale as string,
    enabledLocales: row.enabled_locales as string[],
    reviewedLocales: row.reviewed_locales as string[],
    categories: row.categories as string[],
    unpublishedSections: row.unpublished_sections as number,
    linkOn: row.link_created_at !== null,
    linkCreatedAt: row.link_created_at ? (row.link_created_at as Date).toISOString() : null,
    opens30d: row.opens_30d as number,
    messages30d: row.messages_30d as number,
    waiting: row.waiting as number,
    hero: row.hero_created_at
      ? toHeroImage({
          alt: row.hero_alt as string,
          width: row.hero_width as number,
          height: row.hero_height as number,
          created_at: row.hero_created_at as Date,
        })
      : null,
  }));
}
