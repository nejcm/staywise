import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getGuestPage } from '../guest-fns';
import type { GuestPage } from '../share.server';

export const Route = createFileRoute('/g/$shareId')({
  beforeLoad: async ({ params }) => {
    const result = await getGuestPage({ data: { shareId: params.shareId } });
    const guest: GuestPage = 'error' in result ? { state: 'denied' } : result;
    return { guest, shareId: params.shareId };
  },
  component: GuestLayout,
});

function GuestLayout() {
  const { guest, shareId } = Route.useRouteContext();

  useEffect(() => {
    // The entry fragment exchanged for the session cookie; keep it out of the address bar.
    if (guest.state === 'guide' && window.location.hash) {
      history.replaceState(null, '', window.location.pathname);
    }
  }, [guest.state]);

  if (guest.state === 'denied') {
    return (
      <main className="guest">
        <GuestOpen shareId={shareId} />
      </main>
    );
  }
  return (
    <main className="guest" lang={guest.guest.sourceLocale}>
      <header className="guest-header">
        <p className="guest-label">Guest</p>
        <h1>{guest.guest.displayName}</h1>
        <GuestNav shareId={shareId} />
      </header>
      <Outlet />
    </main>
  );
}

function GuestNav({ shareId }: { shareId: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tabs = [
    { href: `/g/${shareId}`, label: 'Home' },
    { href: `/g/${shareId}/guide`, label: 'Guide' },
    { href: `/g/${shareId}/help`, label: 'Help' },
  ];
  return (
    <nav aria-label="Guest guide">
      {tabs.map((tab) => (
        // Full document loads keep the /g-scoped cookie on every request and re-check the link.
        <a key={tab.href} href={tab.href} aria-current={pathname === tab.href ? 'page' : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

// Identical markup for every denied state; the link's secret, if any, is read from the fragment
// client-side and exchanged for the host-checked session cookie.
function GuestOpen({ shareId }: { shareId: string }) {
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let active = true;
    const secret = window.location.hash.replace(/^#/, '');
    if (!secret) {
      setDenied(true);
      return;
    }
    fetch(`/g/${shareId}/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    })
      .then((response) => {
        if (!active) return;
        if (response.ok) {
          window.location.replace(window.location.pathname);
        } else {
          setDenied(true);
        }
      })
      .catch(() => {
        if (active) setDenied(true);
      });
    return () => {
      active = false;
    };
  }, [shareId]);

  if (denied) {
    return (
      <section className="guest-card" data-testid="guest-denied">
        <h1>This link can&apos;t be opened</h1>
        <p>Ask your host to send you a new link.</p>
      </section>
    );
  }
  return (
    <section className="guest-card" data-testid="guest-opening">
      <h1>Opening your guide…</h1>
      <p>Stay on this page while we check your link.</p>
      <noscript>
        <p>This guide needs JavaScript to open the link. Ask your host to resend it.</p>
      </noscript>
    </section>
  );
}
