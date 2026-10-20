import { createServerFn } from '@tanstack/react-start';
import { appendResponseHeader, getRequest } from '@tanstack/react-start/server';
import { serverEnv } from '../../lib/env.server';
import { runGuarded } from '../../lib/fn-guards.server';
import {
  guestPageInput,
  guestSessionToken,
  readGuestPage,
  resolveGuestLocale,
  serializeLanguageCookie,
} from '../share/share.server';

// The single guest read: no identity, no input beyond the link id in the route, and a uniform
// denial for unknown, disabled, rotated, expired, or unpublished states.
export const getGuestPage = createServerFn({ method: 'POST' })
  .validator((value: unknown) => value as { shareId: string; locale?: string })
  .handler(async ({ data }) => {
    const result = await runGuarded(async () => {
      const input = guestPageInput.safeParse(data);
      if (!input.success) return { state: 'denied' } as const;
      const cookieHeader = getRequest().headers.get('cookie');
      const { locale, remember } = resolveGuestLocale(input.data.locale, cookieHeader);
      if (remember) appendResponseHeader('set-cookie', serializeLanguageCookie(remember, serverEnv.appEnv !== 'local'));
      return readGuestPage({ shareId: input.data.shareId, locale, sessionToken: guestSessionToken(cookieHeader) });
    });
    if ('state' in result && result.state === 'guide') return result;
    return { ...result, locale: deniedLocale(data.locale) };
  });

// Fixed UI languages only, so every denial cause renders the same page for the same request.
function deniedLocale(query: unknown): string {
  try {
    const header = getRequest().headers.get('cookie');
    return resolveGuestLocale(typeof query === 'string' ? query : undefined, header).locale ?? 'en';
  } catch {
    return 'en';
  }
}
