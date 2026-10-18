import { createFileRoute } from '@tanstack/react-router';
import { guestCategoryLabel, guestLocaleName, guestUiText } from '../guest-ui';

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
          <section className="guest-card" key={`${section.category}-${index}`} data-testid="guest-section">
            <p className="guest-category">{guestCategoryLabel(locale, section.category)}</p>
            <h3 lang={section.fallback ? sourceLocale : undefined}>{section.title}</h3>
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
    </>
  );
}
