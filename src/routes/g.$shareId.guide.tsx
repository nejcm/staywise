import { createFileRoute } from '@tanstack/react-router';
import { sectionCategoryLabels } from '../guide-validation';

export const Route = createFileRoute('/g/$shareId/guide')({
  component: GuestGuide,
});

function GuestGuide() {
  const { guest } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const { sections } = guest.guest;
  return (
    <>
      <h2>Guide</h2>
      {sections.length === 0 ? (
        <p data-testid="guest-guide-empty">Your host has not published any guide content yet.</p>
      ) : (
        sections.map((section, index) => (
          <section className="guest-card" key={`${section.category}-${index}`} data-testid="guest-section">
            <p className="guest-category">{sectionCategoryLabels[section.category]}</p>
            <h3>{section.title}</h3>
            <p className="guest-body">{section.body}</p>
          </section>
        ))
      )}
    </>
  );
}
