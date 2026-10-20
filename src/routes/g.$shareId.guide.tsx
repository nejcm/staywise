import { createFileRoute } from '@tanstack/react-router';
import { firstLine, guestCategoryLabel, guestLocaleName, guestUiText } from '../features/guest/guest-ui';
import styles from '../features/guest/guest.module.css';

export const Route = createFileRoute('/g/$shareId/guide')({
  component: GuestGuide,
});

function GuestGuide() {
  const { guest } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { locale, sourceLocale, sections } = guest.guest;
  return (
    <>
      <h2>{guestUiText(locale, 'guide.heading')}</h2>
      {sections.length === 0 ? (
        <p data-testid="guest-guide-empty">{guestUiText(locale, 'guide.empty')}</p>
      ) : (
        sections.map((section, index) => (
          <section
            className={`${styles.card} ${styles.section}`}
            key={`${section.category}-${index}`}
            data-testid="guest-section"
          >
            <p className={styles.category}>{guestCategoryLabel(locale, section.category)}</p>
            <details>
              <summary>
                <h3 lang={section.provenance === 'fallback' ? sourceLocale : undefined}>{section.title}</h3>
                <span className={styles.excerpt} lang={section.provenance === 'fallback' ? sourceLocale : undefined}>
                  {firstLine(section.body)}
                </span>
              </summary>
              <div className={styles.prose}>
                <p className={styles.body} lang={section.provenance === 'fallback' ? sourceLocale : undefined}>
                  {section.body}
                </p>
                {section.provenance === 'fallback' ? (
                  <p className={styles.fallback} data-testid="guest-fallback">
                    {guestUiText(locale, 'fallback.notice', { language: guestLocaleName(sourceLocale) })}
                  </p>
                ) : null}
              </div>
            </details>
          </section>
        ))
      )}
    </>
  );
}
