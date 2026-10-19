import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { bearerSecretFromFragment } from '../guest-fragment';
import { getGuestPage } from '../guest-fns';
import { guestLink, guestLocaleName, guestUiText, languageNames } from '../guest-ui';
import type { GuestPage } from '../share.server';

const guestSearchSchema = z.object({ lang: z.string().max(16).optional() }).catch({});

export const Route = createFileRoute('/g/$shareId')({
  validateSearch: (search) => guestSearchSchema.parse(search),
  beforeLoad: async ({ params, search }) => {
    const result = await getGuestPage({ data: { shareId: params.shareId, locale: search.lang } });
    const guest: GuestPage = 'error' in result ? { state: 'denied' } : result;
    return { guest, shareId: params.shareId };
  },
  component: GuestLayout,
});

function GuestLayout() {
  const { guest, shareId } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    // A full reload keeps the /g-scoped cookie; a client-side replace would re-run this route
    // loader through /_serverFn, where that path-scoped cookie is never sent.
    if (guest.state === 'guide' && bearerSecretFromFragment(window.location.hash)) {
      window.location.replace(window.location.pathname + window.location.search);
    }
  }, [guest.state]);

  if (guest.state === 'denied') {
    return (
      <main className="guest">
        <GuestOpen shareId={shareId} />
      </main>
    );
  }
  const { locale, locales, sourceLocale } = guest.guest;
  return (
    <main className="guest" lang={locale}>
      <a
        className="skip-link"
        href="#guest-content"
        data-testid="guest-skip"
        onClick={(event) => {
          // A native hash navigation re-runs the guest loader through /_serverFn, where the /g cookie is absent.
          event.preventDefault();
          document.getElementById('guest-content')?.focus();
        }}
      >
        {guestUiText(locale, 'nav.skip')}
      </a>
      <header className="guest-header">
        <div className="guest-top">
          <p className="guest-label">{guestUiText(locale, 'label.guest')}</p>
          <LocaleSwitch locale={locale} locales={locales} sourceLocale={sourceLocale} pathname={pathname} />
        </div>
        <h1>{guest.guest.displayName}</h1>
        <GuestNav shareId={shareId} locale={locale} sourceLocale={sourceLocale} pathname={pathname} />
      </header>
      <div id="guest-content" tabIndex={-1} data-testid="guest-content">
        <Outlet />
      </div>
    </main>
  );
}

function GuestNav({
  shareId,
  locale,
  sourceLocale,
  pathname,
}: {
  shareId: string;
  locale: string;
  sourceLocale: string;
  pathname: string;
}) {
  const tabs = [
    { href: `/g/${shareId}`, label: guestUiText(locale, 'nav.home') },
    { href: `/g/${shareId}/guide`, label: guestUiText(locale, 'nav.guide') },
    { href: `/g/${shareId}/help`, label: guestUiText(locale, 'nav.help') },
  ];
  return (
    <nav aria-label={guestUiText(locale, 'nav.guide')}>
      {tabs.map((tab) => (
        // Full document loads keep the /g-scoped cookie on every request and re-check the link.
        <a
          key={tab.href}
          href={guestLink(tab.href, locale, sourceLocale)}
          aria-current={pathname === tab.href ? 'page' : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

// Only enabled languages appear; a non-source link carries ?lang= (the current language therefore
// links to itself) and the source language keeps the plain path.
function LocaleSwitch({
  locale,
  locales,
  sourceLocale,
  pathname,
}: {
  locale: string;
  locales: string[];
  sourceLocale: string;
  pathname: string;
}) {
  if (locales.length < 2) return null;
  return (
    <ul className="guest-locales" aria-label={guestUiText(locale, 'nav.languages')} data-testid="guest-locale-switch">
      {locales.map((code) => (
        <li key={code}>
          <a
            href={guestLink(pathname, code, sourceLocale)}
            aria-current={code === locale ? 'true' : undefined}
            data-testid={`guest-locale-${code}`}
          >
            {languageNames[code as keyof typeof languageNames] ?? guestLocaleName(code)}
          </a>
        </li>
      ))}
    </ul>
  );
}

// Identical markup for every denied state; the link's secret, if any, is read from the fragment
// client-side and exchanged for the host-checked session cookie.
function GuestOpen({ shareId }: { shareId: string }) {
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let active = true;
    const secret = bearerSecretFromFragment(window.location.hash);
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
          window.location.replace(window.location.pathname + window.location.search);
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
