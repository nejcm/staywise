import { createFileRoute } from '@tanstack/react-router';
import { readHeroPath } from '../features/guide/guide.server';
import { guestSessionToken, withActiveGuestLink } from '../features/share/share.server';
import { getImage, imageResponse } from '../lib/storage.server';

// Under /g so the Path=/g session cookie is sent; every failure is the same bodiless 404.
export const Route = createFileRoute('/g/$shareId_/hero')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const path = await withActiveGuestLink(
            { shareId: params.shareId, sessionToken: guestSessionToken(request.headers.get('cookie')) },
            (tx, link) => readHeroPath(tx, link.propertyId),
          );
          return imageResponse(path ? await getImage(path) : null);
        } catch {
          return imageResponse(null);
        }
      },
    },
  },
});
