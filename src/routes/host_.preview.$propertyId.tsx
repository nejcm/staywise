import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { getHostAuthState } from '../host-fns';
import { getGuestPreview, recordPreviewOpened } from '../guide-fns';
import { sectionCategoryLabels } from '../guide-validation';

export const Route = createFileRoute('/host_/preview/$propertyId')({
  loader: async ({ params }) => {
    const state = await getHostAuthState();
    if ('error' in state || state.state === 'signed_out') {
      throw redirect({ to: '/auth/sign-in' });
    }
    if (state.state !== 'workspace') {
      throw redirect({ to: '/host' });
    }
    const result = await getGuestPreview({ data: { propertyId: params.propertyId } });
    if ('error' in result) {
      throw redirect({ to: '/host' });
    }
    return { guest: result.guest, guidePublished: result.guidePublished };
  },
  component: PreviewPage,
});

function PreviewPage() {
  const { guest, guidePublished } = Route.useLoaderData();
  const { propertyId } = Route.useParams();
  const recorded = useRef(false);

  // Funnel instrumentation is a POST from the mounted page; the read itself never writes.
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    recordPreviewOpened({ data: { propertyId } }).catch(() => {});
  }, [propertyId]);

  return (
    <main>
      <p>
        <Link to="/host/properties/$propertyId" params={{ propertyId }} data-testid="preview-back">
          Back to editor
        </Link>
      </p>
      <p data-testid="preview-guide-status">
        {guidePublished ? 'Guide is live.' : 'Guide is offline: guests cannot open it yet.'}
      </p>
      <h1 data-testid="preview-property-name">{guest.displayName}</h1>
      {guest.sections.length === 0 ? (
        <p data-testid="preview-empty">No published guest content yet.</p>
      ) : (
        <div>
          {guest.sections.map((section, index) => (
            <section key={`${section.category}-${index}`} data-testid="preview-section">
              <h2>{sectionCategoryLabels[section.category]}</h2>
              <h3 data-testid="preview-section-title">{section.title}</h3>
              <p data-testid="preview-section-body">{section.body}</p>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
