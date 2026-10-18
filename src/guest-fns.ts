import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { runGuarded } from './fn-guards.server';
import { guestPageInput, guestSessionToken, readGuestPage } from './share.server';

// The single guest read: no identity, no input beyond the link id in the route, and a uniform
// denial for unknown, disabled, rotated, expired, or unpublished states.
export const getGuestPage = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { shareId: string })
  .handler(async ({ data }) =>
    runGuarded(async () => {
      const input = guestPageInput.safeParse(data);
      if (!input.success) return { state: 'denied' } as const;
      return readGuestPage({
        shareId: input.data.shareId,
        sessionToken: guestSessionToken(getRequest().headers.get('cookie')),
      });
    }),
  );
