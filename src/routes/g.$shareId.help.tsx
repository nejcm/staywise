import { createFileRoute } from '@tanstack/react-router';
import { AnswerHours, CallStrip } from '../features/guest/guest-essentials';
import { GuestMessageForm } from '../features/guest/guest-message-form';
import { guestLocaleName, guestUiText } from '../features/guest/guest-ui';
import styles from '../features/guest/guest.module.css';

export const Route = createFileRoute('/g/$shareId/help')({
  component: GuestHelp,
});

function GuestHelp() {
  const { guest, shareId } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { locale, sourceLocale, essentials } = guest.guest;
  const emergency = guest.guest.sections.find((section) => section.category === 'emergency');
  return (
    <>
      <h2>{guestUiText(locale, 'help.heading')}</h2>
      <CallStrip
        phone={essentials.contactPhone}
        locale={locale}
        text="help.urgent"
        variant="primary"
        emergency
        testId="guest-help-urgent"
      />
      <section className={`${styles.card} ${styles.callout}`} data-testid="guest-emergency">
        <h3 lang={emergency?.provenance === 'fallback' ? sourceLocale : undefined}>
          {emergency?.title ?? guestUiText(locale, 'help.emergency.title')}
        </h3>
        <p className={styles.body} lang={emergency?.provenance === 'fallback' ? sourceLocale : undefined}>
          {emergency?.body ?? guestUiText(locale, 'help.emergency.fallback')}
        </p>
        {emergency?.provenance === 'fallback' ? (
          <p className={styles.fallback} data-testid="guest-fallback">
            {guestUiText(locale, 'fallback.notice', { language: guestLocaleName(sourceLocale) })}
          </p>
        ) : null}
      </section>
      <section className={styles.card} data-testid="guest-contact">
        <h3>{guestUiText(locale, 'help.contact.title')}</h3>
        <AnswerHours essentials={essentials} locale={locale} />
        <p>{guestUiText(locale, 'help.contact.body')}</p>
        <p className={styles.fallback} data-testid="guest-privacy-summary">
          {guestUiText(locale, 'help.privacy.summary')}{' '}
          <a href="/privacy" data-testid="guest-privacy-link">
            {guestUiText(locale, 'help.privacy.link')}
          </a>
        </p>
      </section>
      <GuestMessageForm shareId={shareId} locale={locale} phone={essentials.contactPhone} />
    </>
  );
}
