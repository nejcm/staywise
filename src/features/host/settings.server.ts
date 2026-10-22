import type postgres from 'postgres';
import type { AuditAction } from '../../lib/audit.server';
import type { z } from 'zod';
import { canonicalInput } from '../../lib/canonical-input.server';
import { hostSettingsInput, type GuestLocale, type GuestTheme } from '../guide/guide-validation';

// Defaults for new properties only: insertProperty copies them in, so later changes never touch
// existing properties. Call inside withOwnerContext; RLS scopes the row to the owner.

export type HostSettings = {
  theme: GuestTheme;
  sourceLocale: GuestLocale;
  enabledLocales: GuestLocale[];
  timezone: string;
  contactPhone: string | null;
  answerFrom: string | null;
  answerTo: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
};

export const builtInHostSettings: HostSettings = {
  theme: 'staywise',
  sourceLocale: 'en',
  enabledLocales: [],
  timezone: 'UTC',
  contactPhone: null,
  answerFrom: null,
  answerTo: null,
  checkinTime: null,
  checkoutTime: null,
};

// Null until the host first saves; callers fall back to builtInHostSettings.
export async function readHostSettings(tx: postgres.TransactionSql): Promise<HostSettings | null> {
  const [row] = await tx<
    {
      theme: GuestTheme;
      source_locale: GuestLocale;
      enabled_locales: GuestLocale[];
      timezone: string;
      contact_phone: string | null;
      answer_from: string | null;
      answer_to: string | null;
      checkin_time: string | null;
      checkout_time: string | null;
    }[]
  >`
    select theme, source_locale, enabled_locales, timezone, contact_phone,
      to_char(answer_from, 'HH24:MI') as answer_from, to_char(answer_to, 'HH24:MI') as answer_to,
      to_char(checkin_time, 'HH24:MI') as checkin_time, to_char(checkout_time, 'HH24:MI') as checkout_time
    from app.host_settings where owner_id = app.current_owner_id()
  `;
  if (!row) return null;
  return {
    theme: row.theme,
    sourceLocale: row.source_locale,
    enabledLocales: row.enabled_locales,
    timezone: row.timezone,
    contactPhone: row.contact_phone,
    answerFrom: row.answer_from,
    answerTo: row.answer_to,
    checkinTime: row.checkin_time,
    checkoutTime: row.checkout_time,
  };
}

export async function writeHostSettings(
  tx: postgres.TransactionSql,
  input: z.input<typeof hostSettingsInput>,
): Promise<void> {
  const p = canonicalInput(hostSettingsInput, input);
  await tx`
    insert into app.host_settings (owner_id, theme, source_locale, enabled_locales, timezone, contact_phone,
      answer_from, answer_to, checkin_time, checkout_time)
    values (app.current_owner_id(), ${p.theme}, ${p.sourceLocale}, ${p.enabledLocales}, ${p.timezone},
      ${p.contactPhone || null}, ${p.answerFrom || null}, ${p.answerTo || null}, ${p.checkinTime || null},
      ${p.checkoutTime || null})
    on conflict (owner_id) do update set
      theme = excluded.theme, source_locale = excluded.source_locale, enabled_locales = excluded.enabled_locales,
      timezone = excluded.timezone, contact_phone = excluded.contact_phone, answer_from = excluded.answer_from,
      answer_to = excluded.answer_to, checkin_time = excluded.checkin_time, checkout_time = excluded.checkout_time,
      updated_at = now()
  `;
}

const securityActions = [
  'sign_in',
  'mfa_enrolled',
  'mfa_unenrolled',
  'mfa_verified',
  'agent_grant_created',
  'agent_grant_revoked',
  'agent_grants_revoked_all',
] as const satisfies readonly AuditAction[];

export type SecurityEvent = {
  id: string;
  action: (typeof securityActions)[number];
  at: string;
  grantName: string | null;
  device: string | null;
  countryCode: string | null;
  city: string | null;
  newDevice: boolean;
};

type SecurityRow = {
  id: string;
  action: SecurityEvent['action'];
  created_at: Date;
  grant_name: string | null;
  device_label: string | null;
  country_code: string | null;
  city: string | null;
  new_device: boolean | null;
};

export async function readSecurityActivity(tx: postgres.TransactionSql): Promise<SecurityEvent[]> {
  const rows = await tx<SecurityRow[]>`
    select a.id::text as id, a.action, a.created_at, g.name as grant_name, a.device_label, a.country_code, a.city,
      a.new_device
    from app.audit_events a
    left join app.agent_grants g on g.id = a.grant_id
    where a.actor_id = app.current_owner_id() and a.action in ${tx([...securityActions])}
    order by a.created_at desc, a.id desc
    limit 20
  `;
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    at: row.created_at.toISOString(),
    grantName: row.grant_name,
    device: row.device_label,
    countryCode: row.country_code,
    city: row.city,
    newDevice: row.new_device === true,
  }));
}
