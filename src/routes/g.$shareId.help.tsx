import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/g/$shareId/help')({
  component: GuestHelp,
});

function GuestHelp() {
  const { guest } = Route.useRouteContext();
  if (guest.state !== 'guide') return null;
  const emergency = guest.guest.sections.find((section) => section.category === 'emergency');
  return (
    <>
      <h2>Help</h2>
      <section className="guest-card" data-testid="guest-emergency">
        <h3>{emergency?.title ?? 'Emergencies'}</h3>
        <p className="guest-body">
          {emergency?.body ?? 'For a real emergency, contact local emergency services immediately.'}
        </p>
      </section>
      <section className="guest-card" data-testid="guest-contact">
        <h3>Contact your host</h3>
        <p>Message or call your host directly if something is wrong or you have a question about your stay.</p>
      </section>
    </>
  );
}
