import { z } from 'zod';
import { HERO_MAX_BYTES } from './image-validation';

export const sectionCategories = [
  'arrival',
  'wifi',
  'parking',
  'rules',
  'appliances',
  'waste',
  'checkout',
  'emergency',
  'local_tips',
] as const;
export type SectionCategory = (typeof sectionCategories)[number];
export type SectionVisibility = 'guest' | 'host';

export const sectionCategoryLabels: Record<SectionCategory, string> = {
  arrival: 'Arrival and access',
  wifi: 'Wi-Fi',
  parking: 'Parking',
  rules: 'House rules',
  appliances: 'Appliances',
  waste: 'Waste and recycling',
  checkout: 'Checkout',
  emergency: 'Emergency contacts',
  local_tips: 'Local tips',
};

// Approved guest UI languages for the pilot; the guest dictionaries and the database checks are
// generated from this list, so a locale cannot be enabled without resources behind it.
export const guestLocales = ['en', 'de', 'sl', 'fr', 'es'] as const;
export type GuestLocale = (typeof guestLocales)[number];
export const guestLocaleSchema = z.enum(guestLocales, 'Choose an approved guest language');

// Preset guest page themes; keys are stored per property and must never be renamed or removed.
export const guestThemes = ['staywise', 'coast', 'alpine', 'terracotta', 'classic'] as const;
export type GuestTheme = (typeof guestThemes)[number];
const guestThemeSchema = z.enum(guestThemes, 'Choose a guest page theme');

const enabledLocalesSchema = z
  .array(guestLocaleSchema)
  .max(3, 'Enable at most three guest languages')
  .transform((values) => [...new Set(values)].sort());

const supportedTimeZones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
// V8 omits 'UTC' from supportedValuesOf, and every existing row defaults to it.
export const timeZones = [...new Set(['UTC', ...supportedTimeZones])].sort();

// Engines list different spellings (Europe/Kiev vs Europe/Kyiv), so any zone the engine resolves is
// accepted except offsets and mis-cased names.
export function isTimeZone(value: string): boolean {
  if (timeZones.includes(value)) return true;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
    return /^[A-Za-z]/.test(value) && (resolved === value || resolved.toLowerCase() !== value.toLowerCase());
  } catch {
    return false;
  }
}

export const propertyFields = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a property name')
    .max(120, 'Property name must be 120 characters or fewer'),
  sourceLocale: guestLocaleSchema,
  enabledLocales: enabledLocalesSchema.default([]),
  timezone: z.string().max(64).optional(),
});
export const createPropertyInput = propertyFields.pick({ displayName: true });

// Credentials are stored verbatim; whitespace-only is refused so a blank-looking value is never stored.
const essentialText = (max: number, message: string) =>
  z
    .string()
    .max(max, message)
    .refine((value) => value === '' || value.trim() !== '', 'Enter a value or leave the field empty')
    .refine((value) => !hasControlCharacters(value), 'Remove control characters')
    .optional();
const essentialTime = z
  .string()
  .trim()
  .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time as HH:MM')
  .optional();

// Omitted means "leave unchanged"; an empty string clears the stored value.
const essentialsShape = {
  wifiName: essentialText(64, 'Network name must be 64 characters or fewer'),
  wifiPassword: essentialText(128, 'Wi-Fi password must be 128 characters or fewer'),
  keyboxCode: essentialText(32, 'Key-box code must be 32 characters or fewer'),
  checkinTime: essentialTime,
  checkoutTime: essentialTime,
  address: essentialText(200, 'Address must be 200 characters or fewer'),
  contactPhone: z
    .string()
    .trim()
    .regex(/^$|^\+[1-9]\d{6,14}$/, 'Enter the number in international format, e.g. +38641234567')
    .optional(),
  answerFrom: essentialTime,
  answerTo: essentialTime,
};
export const essentialsFields = z.object(essentialsShape);

// Both answering times or neither; an omitted side is checked against the stored value by updateProperty.
export function answerHoursPaired(value: { answerFrom?: string; answerTo?: string }): boolean {
  return value.answerFrom === undefined || value.answerTo === undefined || !value.answerFrom === !value.answerTo;
}
export const answerHoursPairedIssue = { message: 'Enter both answering times or neither', path: ['answerTo'] };

// The host's sign-in address for the minimal new-message alert; stored server-side and never shown
// to guests.
export const alertEmailSchema = z.string().trim().max(254).pipe(z.email());

const sectionFieldsShape = {
  category: z.enum(sectionCategories, 'Choose a section category'),
  title: z.string().trim().min(1, 'Enter a section title').max(200, 'Section title must be 200 characters or fewer'),
  body: z.string().max(8000, 'Section text must be 8000 characters or fewer'),
  visibility: z.enum(['guest', 'host']),
  secretValue: z.string().trim().max(500, 'Secret value must be 500 characters or fewer').default(''),
  published: z.boolean(),
};

const secretOnlyOnPrivateNote = {
  message: 'A secret value belongs to a private note',
  path: ['secretValue'] as PropertyKey[],
};

export const sectionFields = z
  .object(sectionFieldsShape)
  .refine((value) => value.visibility === 'host' || value.secretValue === '', secretOnlyOnPrivateNote);

export const createSectionInput = z.object({
  propertyId: z.uuid(),
  category: z.enum(sectionCategories, 'Choose a section category'),
  fromGap: z.boolean().optional(),
});
export const saveSectionInput = z
  .object({
    propertyId: z.uuid(),
    sectionId: z.uuid(),
    // The revision the editor loaded; when present, a save over a newer revision is refused.
    expectedRevision: z.number().int().positive().optional(),
    ...sectionFieldsShape,
  })
  .refine((value) => value.visibility === 'host' || value.secretValue === '', secretOnlyOnPrivateNote);
export const savePropertyInput = propertyFields
  .extend({ propertyId: z.uuid(), theme: guestThemeSchema.optional(), ...essentialsShape })
  .refine(answerHoursPaired, answerHoursPairedIssue);
export const hostSettingsInput = essentialsFields
  .pick({ checkinTime: true, checkoutTime: true, contactPhone: true, answerFrom: true, answerTo: true })
  .extend({
    theme: guestThemeSchema,
    sourceLocale: guestLocaleSchema,
    enabledLocales: enabledLocalesSchema.default([]),
    timezone: z.string().max(64).refine(isTimeZone, 'Choose a time zone'),
  })
  .refine((value) => !value.answerFrom === !value.answerTo, answerHoursPairedIssue);
export const copyPropertyInput = z.object({ sourcePropertyId: z.uuid() });
export const setGuidePublishedInput = z.object({ propertyId: z.uuid(), published: z.boolean() });
export const moveSectionInput = z.object({
  propertyId: z.uuid(),
  sectionId: z.uuid(),
  direction: z.enum(['up', 'down']),
});
export const propertyIdInput = z.object({ propertyId: z.uuid() });
export const heroAltSchema = z
  .string()
  .trim()
  .min(1, 'Describe the photo for guests who cannot see it')
  .max(200, 'Photo description must be 200 characters or fewer')
  .refine((value) => !hasControlCharacters(value), 'Remove control characters');
export const heroWriteInput = z.object({
  propertyId: z.uuid(),
  alt: heroAltSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().min(1).max(HERO_MAX_BYTES),
});
export const previewGuideInput = z.object({ propertyId: z.uuid(), locale: z.string().max(16).optional() });

// C0 controls other than tab, newline, and carriage return are never legitimate in prose or
// provider output and would corrupt rendering, logs, and comparisons.
export function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) return true;
  }
  return false;
}

const translatedText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .min(1, 'Enter the translated text')
    .max(max, message)
    .refine((value) => !hasControlCharacters(value), 'Remove control characters');

export const translationInput = z.object({ propertyId: z.uuid(), translationId: z.uuid() });
export const translatedTitleSchema = z
  .string()
  .trim()
  .min(1, 'Enter the translated title')
  .max(400, 'Translated title must be 400 characters or fewer')
  .refine((value) => !hasControlCharacters(value), 'Remove control characters');
export const translatedBodySchema = translatedText(16000, 'Translated text must be 16000 characters or fewer');
export const approveTranslationInput = translationInput.extend({
  sourceRevision: z.number().int().positive(),
  title: translatedTitleSchema,
  body: translatedBodySchema,
});

// Field-level error map for native form rendering; the first message per field wins.
export function collectFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !(field in errors)) errors[field] = issue.message;
  }
  return errors;
}
