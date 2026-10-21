import { createFileRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Icon, categoryIcon } from '../components/icons';
import { sectionHref } from '../features/guest/guest-sections';
import { guestLink, guestLocaleName, guestUiText } from '../features/guest/guest-ui';
import styles from '../features/guest/guest.module.css';

export const Route = createFileRoute('/g/$shareId/guide_/$index')({
  component: GuestSection,
});

function GuestSection() {
  const { guest, shareId, lang } = Route.useRouteContext();
  const { index } = Route.useParams();
  if (guest.state !== 'guide') return null;
  const { locale, sourceLocale, sections } = guest.guest;
  const home = `/g/${shareId}`;
  const position = /^\d+$/.test(index) ? Number(index) - 1 : -1;
  const section = sections[position];
  if (!section) {
    return (
      <section className={styles.card} data-testid="guest-section-missing">
        <p>{guestUiText(locale, 'guide.missing')}</p>
        <a href={guestLink(`${home}/guide`, lang)}>{guestUiText(locale, 'guide.heading')}</a>
      </section>
    );
  }
  const sourceLang = section.provenance === 'fallback' ? sourceLocale : undefined;
  const previous = sections[position - 1];
  const next = sections[position + 1];
  return (
    <>
      <h1 className={styles.sectionTitle} lang={sourceLang}>
        <Icon icon={categoryIcon(section.category)} className={styles.titleIcon} />
        {section.title}
      </h1>
      <article className={`${styles.card} ${styles.prose}`}>
        <p className={styles.body} lang={sourceLang}>
          {section.body}
        </p>
        {sourceLang ? (
          <p className={styles.fallback} data-testid="guest-fallback">
            {guestUiText(locale, 'fallback.notice', { language: guestLocaleName(sourceLocale) })}
          </p>
        ) : null}
      </article>
      {previous || next ? (
        <nav className={styles.pager} aria-label={guestUiText(locale, 'guide.sectionNav')}>
          {next ? (
            <a className={styles.next} href={sectionHref(home, position + 1, lang)} rel="next">
              <span>
                <small>{guestUiText(locale, 'guide.next')}</small>
                <strong>{next.title}</strong>
              </span>
              <Icon icon={ChevronRight} />
            </a>
          ) : null}
          {previous ? (
            <a href={sectionHref(home, position - 1, lang)} rel="prev">
              <Icon icon={ChevronLeft} />
              <span>
                <small>{guestUiText(locale, 'guide.previous')}</small>
                <strong>{previous.title}</strong>
              </span>
            </a>
          ) : null}
        </nav>
      ) : null}
      <p className={styles.report}>
        <a href={guestLink(`${home}/help`, lang)}>{guestUiText(locale, 'guide.report')}</a>
      </p>
    </>
  );
}
