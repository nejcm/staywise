import type { z } from 'zod';

// Canonical writes validate with the shared schemas; HTTP handlers parse first only to surface
// field-level errors, so direct callers cannot store input the HTTP boundary would reject.
export function canonicalInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('invalid_input');
  return parsed.data;
}
