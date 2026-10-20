import { createFileRoute } from '@tanstack/react-router';
import { guestCategoryLabel, guestLink, guestLocaleName, guestUiText } from '../features/guest/guest-ui';
import type { SectionCategory } from '../features/guide/guide-validation';
import styles from '../features/guest/guest.module.css';
import { buttonClass } from '../components/button';
import { EssentialsList, hasEssentials } from '../features/guest/guest-essentials';

export const Route = createFileRoute('/g/$shareId/')({
  component: GuestHome,
});

// Check-in, Wi-Fi, and emergency details first, then the Help entry for contacting the host.
const homeCategories: SectionCategory[] = ['arrival', 'wifi', 'emergency'];

function GuestHome() {
  const { guest, shareId, lang } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { locale, sourceLocale } = guest.guest;
  const highlights = homeCategories
    .map((category) => guest.guest.sections.find((section) => section.category === category))
    .filter((section) => section !== undefined);
  return (
    <>
      <h2>{guestUiText(locale, 'home.heading')}</h2>
      {hasEssentials(guest.guest.essentials) ? (
        <section className={`${styles.card} ${styles.arrival}`} data-testid="guest-home-essentials">
          <h3>{guestUiText(locale, 'essentials.title')}</h3>
          <EssentialsList essentials={guest.guest.essentials} locale={locale} />
        </section>
      ) : null}
      {highlights.length === 0 && !hasEssentials(guest.guest.essentials) ? (
        <p data-testid="guest-home-empty">{guestUiText(locale, 'home.empty')}</p>
      ) : (
        highlights.map((section) => (
          <section className={`${styles.card} ${styles.arrival}`} key={section.category} data-testid="guest-highlight">
            <h3>{guestCategoryLabel(locale, section.category)}</h3>
            <p className={styles.body} lang={section.provenance === 'fallback' ? sourceLocale : undefined}>
              {section.body}
            </p>
            {section.provenance === 'fallback' ? (
              <p className={styles.fallback} data-testid="guest-fallback">
                {guestUiText(locale, 'fallback.notice', { language: guestLocaleName(sourceLocale) })}
              </p>
            ) : null}
          </section>
        ))
      )}
      <section className={`${styles.card} ${styles.callout}`} data-testid="guest-home-help">
        <h3>{guestUiText(locale, 'home.help.title')}</h3>
        <p>{guestUiText(locale, 'home.help.body')}</p>
        <a className={`${buttonClass('secondary')} ${styles.pill}`} href={guestLink(`/g/${shareId}/help`, lang)}>
          {guestUiText(locale, 'home.help.open')}
        </a>
      </section>
    </>
  );
}
