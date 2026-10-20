import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { buttonClass } from '../components/button';
import { Pill } from '../components/pill';
import { AddressLine, AnswerHours, CallStrip, EssentialsList, hasEssentials } from '../features/guest/guest-essentials';
import { getHostAuthState } from '../features/host/host-fns';
import { getGuestPreview, recordPreviewOpened } from '../features/guide/guide-fns';
import { guestCategoryLabel, guestLocaleName, guestUiText, languageNames } from '../features/guest/guest-ui';
import type { GuestLocale } from '../features/guide/guide-validation';
import styles from '../features/guest/guest.module.css';
import previewStyles from '../features/host/preview.module.css';

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
    return { guest: result.guest, guidePublished: result.guidePublished, essentials: result.essentials };
  },
  component: PreviewPage,
});

function PreviewPage() {
  const { guest, guidePublished, essentials } = Route.useLoaderData();
  const { propertyId } = Route.useParams();
  const recorded = useRef(false);

  // Funnel instrumentation is a POST from the mounted page; the read itself never writes.
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    recordPreviewOpened({ data: { propertyId } }).catch(() => {});
  }, [propertyId]);

  return (
    <div className={previewStyles.page}>
      <div role="region" aria-label="Preview controls" className={previewStyles.bar}>
        <Link
          to="/host/properties/$propertyId"
          params={{ propertyId }}
          className={buttonClass()}
          data-testid="preview-back"
        >
          Back to editor
        </Link>
        <span className={previewStyles.chip}>Preview</span>
        <div className={previewStyles.status}>
          <h1 data-testid="preview-property-name">{guest.displayName}</h1>
          <p data-testid="preview-locale-status">
            Guests read this guide in:{' '}
            {guest.locales.map((code) => languageNames[code as GuestLocale] ?? code).join(', ')}. Showing{' '}
            {languageNames[guest.locale as GuestLocale] ?? guest.locale}.
          </p>
        </div>
        <Pill tone={guidePublished ? 'positive' : 'neutral'} testId="preview-guide-status">
          {guidePublished ? 'Guide is live.' : 'Guide is offline: guests cannot open it yet.'}
        </Pill>
      </div>
      <main className={previewStyles.stage}>
        <div className={previewStyles.phone}>
          <p className={previewStyles.banner}>Preview · not visible to guests</p>
          <div className={`${styles.shell} ${styles.preview}`}>
            {guest.locales.length > 1 ? (
              <ul className={styles.locales} data-testid="preview-locale-switch">
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
            {essentials.address ? (
              <AddressLine address={essentials.address} locale={guest.locale} testId="preview-address" />
            ) : null}
            {essentials.contactPhone ? (
              <section className={`${styles.card} ${styles.callout}`} data-testid="preview-contact">
                <AnswerHours essentials={essentials} locale={guest.locale} />
                <CallStrip
                  phone={essentials.contactPhone}
                  locale={guest.locale}
                  text="help.urgent"
                  variant="primary"
                  emergency
                  testId="preview-urgent"
                />
              </section>
            ) : null}
            {hasEssentials(essentials) ? (
              <section className={`${styles.card} ${styles.arrival}`} data-testid="preview-essentials">
                <h2 className={styles.category}>Essentials · shown to guests after they open the link</h2>
                <EssentialsList essentials={essentials} locale={guest.locale} />
              </section>
            ) : null}
            {guest.sections.length === 0 ? (
              <p className={`${styles.card} ${styles.empty}`} data-testid="preview-empty">
                No published guest content yet.
              </p>
            ) : (
              guest.sections.map((section, index) => (
                <section
                  key={`${section.category}-${index}`}
                  className={`${styles.card} ${styles.prose}`}
                  data-testid="preview-section"
                >
                  <h2 className={styles.category}>{guestCategoryLabel(guest.locale, section.category)}</h2>
                  <h3
                    lang={section.provenance === 'fallback' ? guest.sourceLocale : undefined}
                    data-testid="preview-section-title"
                  >
                    {section.title}
                  </h3>
                  <p
                    className={styles.body}
                    lang={section.provenance === 'fallback' ? guest.sourceLocale : undefined}
                    data-testid="preview-section-body"
                  >
                    {section.body}
                  </p>
                  {section.provenance === 'fallback' ? (
                    <p className={styles.fallback} data-testid="preview-fallback">
                      {guestUiText(guest.locale, 'fallback.notice', { language: guestLocaleName(guest.sourceLocale) })}
                    </p>
                  ) : null}
                </section>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
