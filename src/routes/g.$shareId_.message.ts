import { createFileRoute } from '@tanstack/react-router';
import { serverEnv } from '../lib/env.server';
import { bumpGuestCounter } from '../features/guest/guest-counters.server';
import { sendGuestMessageAlert } from '../lib/mail.server';
import {
  MESSAGE_REQUEST_MAX,
  collectMessageFieldErrors,
  guestMessageFields,
  readBoundedText,
} from '../features/messages/message-validation';
import { submitGuestMessage } from '../features/messages/messages.server';
import { guestSessionToken } from '../features/share/share.server';

// Guest message intake: the same boundary shape as the link exchange — exact same-origin JSON POST
// with the Path=/g session cookie — and one JSON state per outcome, never guest content echoes.
function state(state: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ state, ...extra }), {
    status,
    headers: { 'cache-control': 'private, no-store', 'content-type': 'application/json' },
  });
}

export const Route = createFileRoute('/g/$shareId_/message')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          if (request.headers.get('origin') !== serverEnv.appOrigin) return state('denied', 403);
          const contentType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
          if (contentType !== 'application/json') return state('denied', 403);
          // Content-Length is an optional early rejection; the byte bound is enforced while reading.
          const declared = Number(request.headers.get('content-length') ?? '');
          if (Number.isFinite(declared) && declared > MESSAGE_REQUEST_MAX) return state('denied', 403);
          const bounded = await readBoundedText(request.body, MESSAGE_REQUEST_MAX);
          if (bounded.state === 'denied' || !bounded.text) return state('denied', 403);
          const raw = bounded.text;
          let body: unknown = null;
          try {
            body = JSON.parse(raw);
          } catch {
            body = null;
          }
          const fields = guestMessageFields.safeParse(body);
          if (!fields.success) {
            return state('invalid', 400, { fields: collectMessageFieldErrors(fields.error) });
          }
          const result = await submitGuestMessage({
            shareId: params.shareId,
            sessionToken: guestSessionToken(request.headers.get('cookie')),
            message: fields.data,
          });
          if (result.state === 'denied') return state('denied', 403);
          if (result.state === 'rate_limited') return state('rate_limited', 429);
          // A suppressed duplicate is the same submission from the guest's point of view.
          if (result.state === 'duplicate') return state('ok', 200);
          // Post-commit side effects: neither can fail or duplicate the already-stored message.
          await bumpGuestCounter({
            shareId: params.shareId,
            propertyId: result.propertyId,
            kind: 'submissions',
          });
          if (result.alertEmail) await sendGuestMessageAlert(result.alertEmail);
          return state('ok', 200);
        } catch {
          return state('error', 500);
        }
      },
      GET: () => new Response(null, { status: 405, headers: { allow: 'POST' } }),
    },
  },
});
