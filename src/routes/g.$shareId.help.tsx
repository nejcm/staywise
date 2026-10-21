import { createFileRoute } from '@tanstack/react-router';
import { CallStrip } from '../features/guest/guest-essentials';
import { GuestMessageForm } from '../features/guest/guest-message-form';
import { guestUiText, messageRetentionDays } from '../features/guest/guest-ui';
import styles from '../features/guest/guest.module.css';

export const Route = createFileRoute('/g/$shareId/help')({
  component: GuestHelp,
});

function GuestHelp() {
  const { guest, shareId } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { locale, essentials } = guest.guest;
  return (
    <>
      <div className={styles.intro}>
        <h1 className={styles.helpTitle}>{guestUiText(locale, 'help.heading')}</h1>
        <p className={styles.subtitle}>{guest.guest.displayName}</p>
      </div>
      <CallStrip
        phone={essentials.contactPhone}
        locale={locale}
        text="help.urgent"
        variant="primary"
        emergency
        testId="guest-help-urgent"
      />
      <GuestMessageForm shareId={shareId} locale={locale} phone={essentials.contactPhone} />
      <section className={styles.privacy} aria-labelledby="guest-privacy-title" data-testid="guest-privacy-panel">
        <h2 id="guest-privacy-title">{guestUiText(locale, 'help.privacy.title')}</h2>
        <ul>
          <li>{guestUiText(locale, 'help.privacy.sent')}</li>
          <li>{guestUiText(locale, 'help.privacy.seen')}</li>
          <li>{guestUiText(locale, 'help.privacy.retention', { days: String(messageRetentionDays) })}</li>
          <li>{guestUiText(locale, 'form.noReply')}</li>
        </ul>
        <a href="/privacy" data-testid="guest-privacy-link">
          {guestUiText(locale, 'help.privacy.link')}
        </a>
      </section>
    </>
  );
}
