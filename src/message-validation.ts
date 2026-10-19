import { z } from 'zod';
import { guestLocaleSchema, hasControlCharacters, sectionCategories, type SectionCategory } from './guide-validation';

// Shared vocabulary for guest message intake: the HTTP boundary, the canonical store, and the host
// inbox all validate against these fields.

const messageKinds = ['issue', 'question'] as const;
export type MessageKind = (typeof messageKinds)[number];

const MESSAGE_BODY_MAX = 2000;
const MESSAGE_EMAIL_MAX = 254;
// Bounds the raw request in bytes before JSON parsing, well above the largest valid payload.
export const MESSAGE_REQUEST_MAX = 8192;

// Reads at most maxBytes of incoming bytes, cancelling the reader instead of buffering more, then
// decodes only the bounded buffer. Content-Length is an optional early rejection, never the control.
export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ state: 'ok'; text: string } | { state: 'denied' }> {
  if (!body) return { state: 'ok', text: '' };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return { state: 'denied' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { state: 'ok', text };
  } catch {
    await reader.cancel().catch(() => {});
    return { state: 'denied' };
  }
}

// Fixed-window submission limits, keyed by HMAC fingerprints, never raw identifiers.
export const messageLimits = {
  sessionPerHour: 5,
  linkPerHour: 20,
  propertyPerDay: 100,
} as const;

// An identical retry from one session inside this window is the same submission.
export const duplicateWindowMinutes = 5;

const messageFieldErrorCodes = [
  'message_required',
  'message_too_long',
  'message_invalid',
  'email_invalid',
  'category_invalid',
  'kind_invalid',
] as const;
export type MessageFieldError = (typeof messageFieldErrorCodes)[number] | 'invalid';

const replyEmailSchema = z
  .string()
  .trim()
  .max(MESSAGE_EMAIL_MAX, 'email_invalid')
  .refine((value) => value === '' || z.email().safeParse(value).success, 'email_invalid');

// The guest sends an address only when they asked for a reply; an empty string means no request.
export const guestMessageFields = z.object({
  kind: z.enum(messageKinds, 'kind_invalid'),
  category: z.enum(sectionCategories, 'category_invalid'),
  locale: guestLocaleSchema,
  body: z
    .string()
    .trim()
    .min(1, 'message_required')
    .max(MESSAGE_BODY_MAX, 'message_too_long')
    .refine((value) => !hasControlCharacters(value), 'message_invalid'),
  replyEmail: replyEmailSchema,
});
export type GuestMessageFields = z.infer<typeof guestMessageFields>;

export const inboxInput = z.object({ propertyId: z.uuid() });
export const messageActionInput = z.object({ propertyId: z.uuid(), messageId: z.uuid() });
export const setAnswerInGuideInput = messageActionInput.extend({ answerInGuide: z.boolean() });

// Unknown messages collapse to one generic code so internals never leak into guest errors.
export function collectMessageFieldErrors(error: z.ZodError): Record<string, MessageFieldError> {
  const fields: Record<string, MessageFieldError> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || field in fields) continue;
    fields[field] = (messageFieldErrorCodes as readonly string[]).includes(issue.message)
      ? (issue.message as MessageFieldError)
      : 'invalid';
  }
  return fields;
}

export function asSectionCategory(value: string | null): SectionCategory | null {
  return value !== null && (sectionCategories as readonly string[]).includes(value) ? (value as SectionCategory) : null;
}
