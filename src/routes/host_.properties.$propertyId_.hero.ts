import { createFileRoute } from '@tanstack/react-router';
import { heroObjectPath, ownsProperty, readHeroPath, upsertHero } from '../features/guide/guide.server';
import { heroAltSchema, propertyIdInput } from '../features/guide/guide-validation';
import { HERO_MAX_BYTES, parseJpeg } from '../features/guide/image-validation';
import { readBoundedBytes } from '../features/messages/message-validation';
import { withOwnerContext } from '../lib/db.server';
import { serverEnv } from '../lib/env.server';
import { aal2Host } from '../lib/fn-guards.server';
import { drainStorageDeletions, getImage, imageResponse, putImage, removeImage } from '../lib/storage.server';

function state(value: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ state: value, ...extra }), {
    status,
    headers: { 'cache-control': 'private, no-store', 'content-type': 'application/json' },
  });
}

function decodedAlt(header: string | null): string | null {
  try {
    return header === null ? null : decodeURIComponent(header);
  } catch {
    return null;
  }
}

// A failed commit acknowledgement may still have committed, so only an object no row points at is removed.
async function discardIfUnreferenced(userId: string, propertyId: string, objectPath: string): Promise<void> {
  const current = await withOwnerContext(userId, (tx) => readHeroPath(tx, propertyId)).catch(() => objectPath);
  if (current !== objectPath) await removeImage(objectPath);
}

export const Route = createFileRoute('/host_/properties/$propertyId_/hero')({
  server: {
    handlers: {
      // Raw JPEG body, alt text URI-encoded in x-hero-alt; the browser re-encodes before upload (ADR 0005).
      POST: async ({ request, params }) => {
        try {
          if (request.headers.get('origin') !== serverEnv.appOrigin) return state('denied', 403);
          if (!serverEnv.supabaseSecretKey) return state('unavailable', 503);
          const host = await aal2Host();
          if ('error' in host) return state('denied', 403);
          const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
          const property = propertyIdInput.safeParse({ propertyId: params.propertyId });
          const alt = heroAltSchema.safeParse(decodedAlt(request.headers.get('x-hero-alt')));
          if (contentType !== 'image/jpeg' || !property.success || !alt.success) return state('invalid', 400);
          const declared = Number(request.headers.get('content-length') ?? '');
          if (Number.isFinite(declared) && declared > HERO_MAX_BYTES) return state('too_large', 413);
          const body = await readBoundedBytes(request.body, HERO_MAX_BYTES);
          if (body.state === 'denied') return state('too_large', 413);
          const size = parseJpeg(body.bytes);
          if (!size) return state('invalid', 400);
          const propertyId = property.data.propertyId;
          const owned = await withOwnerContext(host.userId, (tx) => ownsProperty(tx, propertyId));
          if (!owned) return state('denied', 403);
          // Storage I/O stays outside any transaction; a failed upload leaves the current hero untouched.
          const objectPath = heroObjectPath(propertyId);
          if (!(await putImage(objectPath, body.bytes).catch(() => false))) {
            // A timed-out upload may have landed anyway; no row references the key yet.
            await removeImage(objectPath);
            return state('error', 500);
          }
          const input = { propertyId, alt: alt.data, bytes: body.bytes.byteLength, ...size };
          const hero = await withOwnerContext(host.userId, (tx) => upsertHero(tx, objectPath, input)).catch(
            async (error: unknown) => {
              await discardIfUnreferenced(host.userId, propertyId, objectPath);
              throw error;
            },
          );
          if (!hero) {
            await removeImage(objectPath);
            return state('denied', 403);
          }
          await drainStorageDeletions().catch(() => 0);
          return state('ok', 200, { hero });
        } catch {
          return state('error', 500);
        }
      },
      GET: async ({ params }) => {
        try {
          const property = propertyIdInput.safeParse({ propertyId: params.propertyId });
          if (!property.success) return imageResponse(null);
          const host = await aal2Host();
          if ('error' in host) return imageResponse(null);
          const path = await withOwnerContext(host.userId, (tx) => readHeroPath(tx, property.data.propertyId));
          return imageResponse(path ? await getImage(path) : null);
        } catch {
          return imageResponse(null);
        }
      },
    },
  },
});
