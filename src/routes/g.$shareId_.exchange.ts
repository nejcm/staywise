import { createFileRoute } from '@tanstack/react-router';
import { serverEnv } from '../lib/env.server';
import { isSameOriginJson } from '../lib/fn-guards.server';
import { exchangeGuestLink, exchangeGuestLinkInput, serializeGuestCookie } from '../features/share/share.server';

// Pre-session exchange: no cookie yet, so the valid bearer secret plus an exact same-origin JSON
// POST is the whole authorization. Every failure is the same denial.
function denied(): Response {
  return new Response(JSON.stringify({ error: 'denied' }), {
    status: 403,
    headers: { 'cache-control': 'private, no-store', 'content-type': 'application/json' },
  });
}

export const Route = createFileRoute('/g/$shareId_/exchange')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          if (!isSameOriginJson(request)) return denied();
          const body: unknown = await request.json().catch(() => null);
          const secret =
            typeof body === 'object' && body !== null ? (body as Record<string, unknown>).secret : undefined;
          const input = exchangeGuestLinkInput.safeParse({ shareId: params.shareId, secret });
          if (!input.success) return denied();
          const token = await exchangeGuestLink(input.data);
          if (!token) return denied();
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              'cache-control': 'private, no-store',
              'content-type': 'application/json',
              'set-cookie': serializeGuestCookie(token, serverEnv.appEnv !== 'local'),
            },
          });
        } catch {
          return new Response(JSON.stringify({ error: 'unexpected' }), {
            status: 500,
            headers: { 'cache-control': 'private, no-store', 'content-type': 'application/json' },
          });
        }
      },
      GET: () => new Response(null, { status: 405, headers: { allow: 'POST' } }),
    },
  },
});
