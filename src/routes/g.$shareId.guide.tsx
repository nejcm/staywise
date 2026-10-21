import { createFileRoute } from '@tanstack/react-router';
import { buttonClass } from '../components/button';
import { SectionRows } from '../features/guest/guest-sections';
import { guestLink, guestUiText } from '../features/guest/guest-ui';
import styles from '../features/guest/guest.module.css';

export const Route = createFileRoute('/g/$shareId/guide')({
  component: GuestGuide,
});

function GuestGuide() {
  const { guest, shareId, lang } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { locale, sections, essentials } = guest.guest;
  const home = `/g/${shareId}`;
  return (
    <>
      <div className={styles.intro}>
        <h1>{guestUiText(locale, 'guide.heading')}</h1>
        <p className={styles.subtitle}>{guest.guest.displayName}</p>
      </div>
      {sections.length === 0 ? (
        <p data-testid="guest-guide-empty">{guestUiText(locale, 'guide.empty')}</p>
      ) : (
        <SectionRows label={guestUiText(locale, 'guide.sections')} guide={guest.guest} home={home} lang={lang} />
      )}
      <section className={styles.callout} aria-labelledby="guest-guide-ask">
        <h2 id="guest-guide-ask">{guestUiText(locale, 'guide.cantFind')}</h2>
        <div className={styles.actions}>
          <a className={buttonClass('primary')} href={guestLink(`${home}/help`, lang)}>
            {guestUiText(locale, 'home.ask')}
          </a>
          {essentials.contactPhone ? (
            <a className={buttonClass('secondary')} href={`tel:${essentials.contactPhone}`}>
              {guestUiText(locale, 'contact.call')}
            </a>
          ) : null}
        </div>
      </section>
    </>
  );
}
