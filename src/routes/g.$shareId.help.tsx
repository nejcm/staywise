import { createFileRoute } from '@tanstack/react-router';
import { GuestMessageForm } from '../features/guest/guest-message-form';
import { guestLocaleName, guestUiText } from '../features/guest/guest-ui';

export const Route = createFileRoute('/g/$shareId/help')({
  component: GuestHelp,
});

function GuestHelp() {
  const { guest, shareId } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { locale, sourceLocale } = guest.guest;
  const emergency = guest.guest.sections.find((section) => section.category === 'emergency');
  return (
    <>
      <h2>{guestUiText(locale, 'help.heading')}</h2>
      <section className="guest-card" data-testid="guest-emergency">
        <h3 lang={emergency?.fallback ? sourceLocale : undefined}>
          {emergency?.title ?? guestUiText(locale, 'help.emergency.title')}
        </h3>
        <p className="guest-body" lang={emergency?.fallback ? sourceLocale : undefined}>
          {emergency?.body ?? guestUiText(locale, 'help.emergency.fallback')}
        </p>
        {emergency?.fallback ? (
          <p className="guest-fallback" data-testid="guest-fallback">
            {guestUiText(locale, 'fallback.notice', { language: guestLocaleName(sourceLocale) })}
          </p>
        ) : null}
      </section>
      <section className="guest-card" data-testid="guest-contact">
        <h3>{guestUiText(locale, 'help.contact.title')}</h3>
        <p>{guestUiText(locale, 'help.contact.body')}</p>
        <p className="guest-fallback" data-testid="guest-privacy-summary">
          {guestUiText(locale, 'help.privacy.summary')}{' '}
          <a href="/privacy" data-testid="guest-privacy-link">
            {guestUiText(locale, 'help.privacy.link')}
          </a>
        </p>
      </section>
      <GuestMessageForm shareId={shareId} locale={locale} />
    </>
  );
}
