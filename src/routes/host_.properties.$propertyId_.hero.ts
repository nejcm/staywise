import { createFileRoute } from '@tanstack/react-router';
import { readHeroPath, reserveHeroUpload, upsertHero } from '../features/guide/guide.server';
import { heroAltSchema, propertyIdInput } from '../features/guide/guide-validation';
import { HERO_MAX_BYTES, parseJpeg } from '../features/guide/image-validation';
import { readBoundedBytes } from '../features/messages/message-validation';
import { withOwnerContext } from '../lib/db.server';
import { serverEnv } from '../lib/env.server';
import { aal2Host } from '../lib/fn-guards.server';
import { drainStorageDeletions, getImage, imageResponse, putImage } from '../lib/storage.server';

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

export const Route = createFileRoute('/host_/properties/$propertyId_/hero')({
  server: {
    handlers: {
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
          const objectPath = await withOwnerContext(host.userId, (tx) => reserveHeroUpload(tx, propertyId));
          if (!objectPath) return state('denied', 403);
          if (!(await putImage(objectPath, body.bytes))) return state('error', 500);
          const input = { propertyId, alt: alt.data, bytes: body.bytes.byteLength, ...size };
          const hero = await withOwnerContext(host.userId, (tx) => upsertHero(tx, objectPath, input));
          if (!hero) return state('denied', 403);
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
