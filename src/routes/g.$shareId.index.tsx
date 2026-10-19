import { createFileRoute } from '@tanstack/react-router';
import { guestCategoryLabel, guestLink, guestLocaleName, guestUiText } from '../features/guest/guest-ui';
import type { SectionCategory } from '../features/guide/guide-validation';

export const Route = createFileRoute('/g/$shareId/')({
  component: GuestHome,
});

// Check-in, Wi-Fi, and emergency details first, then the Help entry for contacting the host.
const homeCategories: SectionCategory[] = ['arrival', 'wifi', 'emergency'];

function GuestHome() {
  const { guest, shareId } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { locale, sourceLocale } = guest.guest;
  const highlights = homeCategories
    .map((category) => guest.guest.sections.find((section) => section.category === category))
    .filter((section) => section !== undefined);
  return (
    <>
      <h2>{guestUiText(locale, 'home.heading')}</h2>
      {highlights.length === 0 ? (
        <p data-testid="guest-home-empty">{guestUiText(locale, 'home.empty')}</p>
      ) : (
        highlights.map((section) => (
          <section className="guest-card" key={section.category} data-testid="guest-highlight">
            <h3>{guestCategoryLabel(locale, section.category)}</h3>
            <p className="guest-body" lang={section.fallback ? sourceLocale : undefined}>
              {section.body}
            </p>
            {section.fallback ? (
              <p className="guest-fallback" data-testid="guest-fallback">
                {guestUiText(locale, 'fallback.notice', { language: guestLocaleName(sourceLocale) })}
              </p>
            ) : null}
          </section>
        ))
      )}
      <section className="guest-card guest-callout" data-testid="guest-home-help">
        <h3>{guestUiText(locale, 'home.help.title')}</h3>
        <p>{guestUiText(locale, 'home.help.body')}</p>
        <p>
          <a href={guestLink(`/g/${shareId}/help`, locale, sourceLocale)}>{guestUiText(locale, 'home.help.open')}</a>
        </p>
      </section>
    </>
  );
}
