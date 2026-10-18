import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { getHostAuthState } from '../host-fns';
import { getGuestPreview, recordPreviewOpened } from '../guide-fns';
import { guestCategoryLabel, guestLocaleName, guestUiText, languageNames } from '../guest-ui';
import type { GuestLocale } from '../guide-validation';

const previewSearchSchema = z.object({ lang: z.string().max(16).optional() }).catch({});

export const Route = createFileRoute('/host_/preview/$propertyId')({
  validateSearch: (search) => previewSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  loader: async ({ params, deps }) => {
    const state = await getHostAuthState();
    if ('error' in state || state.state === 'signed_out') {
      throw redirect({ to: '/auth/sign-in' });
    }
    if (state.state !== 'workspace') {
      throw redirect({ to: '/host' });
    }
    const result = await getGuestPreview({ data: { propertyId: params.propertyId, locale: deps.lang } });
    if ('error' in result) {
      throw redirect({ to: '/host' });
    }
    return { guest: result.guest, guidePublished: result.guidePublished };
  },
  component: PreviewPage,
});

function PreviewPage() {
  const { guest, guidePublished } = Route.useLoaderData();
  const { propertyId } = Route.useParams();
  const recorded = useRef(false);

  // Funnel instrumentation is a POST from the mounted page; the read itself never writes.
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    recordPreviewOpened({ data: { propertyId } }).catch(() => {});
  }, [propertyId]);

  return (
    <main>
      <p>
        <Link to="/host/properties/$propertyId" params={{ propertyId }} data-testid="preview-back">
          Back to editor
        </Link>
      </p>
      <p data-testid="preview-guide-status">
        {guidePublished ? 'Guide is live.' : 'Guide is offline: guests cannot open it yet.'}
      </p>
      <h1 data-testid="preview-property-name">{guest.displayName}</h1>
      <p data-testid="preview-locale-status">
        Guests read this guide in: {guest.locales.map((code) => languageNames[code as GuestLocale] ?? code).join(', ')}.
        Showing {languageNames[guest.locale as GuestLocale] ?? guest.locale}.
      </p>
      {guest.locales.length > 1 ? (
        <ul data-testid="preview-locale-switch">
          {guest.locales.map((code) => (
            <li key={code}>
              <Link
                to="/host/preview/$propertyId"
                params={{ propertyId }}
                search={{ lang: code }}
                aria-current={code === guest.locale ? 'true' : undefined}
                data-testid={`preview-locale-${code}`}
              >
                {languageNames[code as GuestLocale] ?? code}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {guest.sections.length === 0 ? (
        <p data-testid="preview-empty">No published guest content yet.</p>
      ) : (
        <div>
          {guest.sections.map((section, index) => (
            <section key={`${section.category}-${index}`} data-testid="preview-section">
              <h2>{guestCategoryLabel(guest.locale, section.category)}</h2>
              <h3 lang={section.fallback ? guest.sourceLocale : undefined} data-testid="preview-section-title">
                {section.title}
              </h3>
              <p lang={section.fallback ? guest.sourceLocale : undefined} data-testid="preview-section-body">
                {section.body}
              </p>
              {section.fallback ? (
                <p data-testid="preview-fallback">
                  {guestUiText(guest.locale, 'fallback.notice', { language: guestLocaleName(guest.sourceLocale) })}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
