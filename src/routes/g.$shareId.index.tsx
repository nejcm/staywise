import { createFileRoute } from '@tanstack/react-router';
import { sectionCategoryLabels, type SectionCategory } from '../guide-validation';

export const Route = createFileRoute('/g/$shareId/')({
  component: GuestHome,
});

// Check-in, Wi-Fi, and emergency details first, then the Help entry for contacting the host.
const homeCategories: SectionCategory[] = ['arrival', 'wifi', 'emergency'];

function GuestHome() {
  const { guest, shareId } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const highlights = homeCategories
    .map((category) => guest.guest.sections.find((section) => section.category === category))
    .filter((section) => section !== undefined);
  return (
    <>
      <h2>Your stay</h2>
      {highlights.length === 0 ? (
        <p data-testid="guest-home-empty">Your host has not published any guide content yet.</p>
      ) : (
        highlights.map((section) => (
          <section className="guest-card" key={section.category} data-testid="guest-highlight">
            <h3>{sectionCategoryLabels[section.category]}</h3>
            <p className="guest-body">{section.body}</p>
          </section>
        ))
      )}
      <section className="guest-card" data-testid="guest-home-help">
        <h3>Need help?</h3>
        <p>Emergency contacts and how to reach your host.</p>
        <p>
          <a href={`/g/${shareId}/help`}>Open Help</a>
        </p>
      </section>
    </>
  );
}
