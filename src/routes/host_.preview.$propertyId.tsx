import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { buttonClass } from '../components/button';
import { Icon, categoryIcon } from '../components/icons';
import { Pill } from '../components/pill';
import { AddressLine, AnswerHours, ArrivalCard, CallStrip } from '../features/guest/guest-essentials';
import { GuestHero } from '../features/guest/guest-hero';
import { getGuestPreview, recordPreviewOpened } from '../features/guide/guide-fns';
import { guestCategoryLabel, guestLocaleName, guestUiText, languageNames } from '../features/guest/guest-ui';
import type { GuestLocale } from '../features/guide/guide-validation';
import styles from '../features/guest/guest.module.css';
import previewStyles from '../features/host/preview.module.css';

const devices = ['phone', 'tablet', 'desktop'] as const;
const previewSearchSchema = z
  .object({
    lang: z.string().max(16).optional(),
    device: z.enum(devices).optional().catch(undefined),
  })
  .catch({});

export const Route = createFileRoute('/host_/preview/$propertyId')({
  validateSearch: (search) => previewSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  loader: async ({ params, deps }) => {
    // One gated read; /host sorts a failed gate into sign-in or the second-factor step.
    const result = await getGuestPreview({ data: { propertyId: params.propertyId, locale: deps.lang } });
    if ('error' in result) throw redirect({ to: '/host' });
    return { guest: result.guest, guidePublished: result.guidePublished, essentials: result.essentials };
  },
  component: PreviewPage,
});

function PreviewPage() {
  const { guest, guidePublished, essentials } = Route.useLoaderData();
  const { propertyId } = Route.useParams();
  const device = Route.useSearch().device ?? 'phone';
  const recorded = useRef(false);

  // Funnel instrumentation is a POST from the mounted page; the read itself never writes.
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    recordPreviewOpened({ data: { propertyId } }).catch(() => {});
  }, [propertyId]);

  return (
    <div className={previewStyles.page}>
      <section aria-label="Preview controls" className={previewStyles.bar}>
        <Link
          to="/host/properties/$propertyId"
          params={{ propertyId }}
          className={buttonClass('secondary', 'sm')}
          aria-label="Back to editor"
          data-testid="preview-back"
        >
          <Icon icon={ChevronLeft} />
          Back
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
        <nav className={previewStyles.seg} aria-label="Preview device">
          {devices.map((option) => (
            <Link
              key={option}
              to="/host/preview/$propertyId"
              params={{ propertyId }}
              search={(prev) => ({ ...prev, device: option })}
              aria-current={option === device ? 'true' : undefined}
              data-testid={`preview-device-${option}`}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </Link>
          ))}
        </nav>
        <Pill tone={guidePublished ? 'positive' : 'neutral'} testId="preview-guide-status">
          {guidePublished ? 'Guide is live.' : 'Guide is offline: guests cannot open it yet.'}
        </Pill>
      </section>
      <main className={previewStyles.stage}>
        <div className={`${previewStyles.frame} ${previewStyles[device]}`} data-testid="preview-frame">
          <p className={previewStyles.banner}>Preview · not visible to guests</p>
          <div className={previewStyles.screen} data-theme={guest.theme}>
            <div className={`${styles.shell} ${styles.preview}`}>
              {guest.locales.length > 1 ? (
                <ul className={styles.locales} data-testid="preview-locale-switch">
                  {guest.locales.map((code) => (
                    <li key={code}>
                      <Link
                        to="/host/preview/$propertyId"
                        params={{ propertyId }}
                        search={(prev) => ({ ...prev, lang: code })}
                        aria-current={code === guest.locale ? 'true' : undefined}
                        data-testid={`preview-locale-${code}`}
                      >
                        {languageNames[code as GuestLocale] ?? code}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <GuestHero hero={guest.hero} src={`/host/properties/${propertyId}/hero`} testId="preview-hero" />
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
              <ArrivalCard essentials={essentials} locale={guest.locale} testId="preview-essentials" />
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
                    <h2 className={styles.category}>
                      <Icon icon={categoryIcon(section.category)} className={styles.categoryIcon} />
                      {guestCategoryLabel(guest.locale, section.category)}
                    </h2>
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
                        {guestUiText(guest.locale, 'fallback.notice', {
                          language: guestLocaleName(guest.sourceLocale),
                        })}
                      </p>
                    ) : null}
                  </section>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
