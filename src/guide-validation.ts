import { z } from 'zod';

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
export const guestLocales = ['en', 'de', 'sl'] as const;
export type GuestLocale = (typeof guestLocales)[number];
export const guestLocaleSchema = z.enum(guestLocales, 'Choose an approved guest language');

const enabledLocalesSchema = z
  .array(guestLocaleSchema)
  .max(3, 'Enable at most three guest languages')
  .transform((values) => [...new Set(values)].sort());

export const propertyFields = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a property name')
    .max(120, 'Property name must be 120 characters or fewer'),
  sourceLocale: guestLocaleSchema,
  enabledLocales: enabledLocalesSchema.default([]),
});

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
});
export const saveSectionInput = z
  .object({ propertyId: z.uuid(), sectionId: z.uuid(), ...sectionFieldsShape })
  .refine((value) => value.visibility === 'host' || value.secretValue === '', secretOnlyOnPrivateNote);
export const savePropertyInput = propertyFields.extend({ propertyId: z.uuid() });
export const copyPropertyInput = z.object({ sourcePropertyId: z.uuid() });
export const setGuidePublishedInput = z.object({ propertyId: z.uuid(), published: z.boolean() });
export const moveSectionInput = z.object({
  propertyId: z.uuid(),
  sectionId: z.uuid(),
  direction: z.enum(['up', 'down']),
});
export const propertyIdInput = z.object({ propertyId: z.uuid() });
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
