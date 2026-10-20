import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { bearerSecretFromFragment } from '../features/guest/guest-fragment';
import { getGuestPage } from '../features/guest/guest-fns';
import { GUEST_OPEN_SLOW_MS, GuestOpening } from '../features/guest/guest-opening';
import { guestLink, guestLocaleName, guestUiText, isGuestLocale, languageNames } from '../features/guest/guest-ui';
import { guestLocales } from '../features/guide/guide-validation';
import type { GuestPage } from '../features/share/share.server';
import styles from '../features/guest/guest.module.css';

const guestSearchSchema = z.object({ lang: z.string().max(16).optional() }).catch({});

export const Route = createFileRoute('/g/$shareId')({
  validateSearch: (search) => guestSearchSchema.parse(search),
  beforeLoad: async ({ params, search }) => {
    const result = await getGuestPage({
      data: { shareId: params.shareId, locale: search.lang },
    });
    const guest: GuestPage = result.state === 'guide' ? result : { state: result.state };
    return {
      guest,
      deniedLocale: 'locale' in result ? result.locale : 'en',
      shareId: params.shareId,
      lang: search.lang && isGuestLocale(search.lang) ? search.lang : undefined,
    };
  },
  component: GuestLayout,
});

function GuestLayout() {
  const { guest, deniedLocale, shareId, lang } = Route.useRouteContext();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const searchStr = useRouterState({
    select: (state) => state.location.searchStr,
  });

  useEffect(() => {
    // A full reload keeps the /g-scoped cookie; a client-side replace would re-run this route
    // loader through /_serverFn, where that path-scoped cookie is never sent.
    if (guest.state === 'guide' && bearerSecretFromFragment(window.location.hash)) {
      window.location.replace(window.location.pathname + window.location.search);
    }
  }, [guest.state]);

  if (guest.state === 'denied') {
    // Only the fixed UI languages: a denied page must not reveal anything about the property.
    return (
      <main className={styles.shell} lang={deniedLocale}>
        <div className={styles.top}>
          <LocaleSwitch locale={deniedLocale} locales={guestLocales} pathname={pathname} />
        </div>
        <GuestOpen shareId={shareId} locale={deniedLocale} />
      </main>
    );
  }
  if (guest.state === 'error') {
    return (
      <main className={styles.shell} lang={deniedLocale}>
        <section className={`${styles.card} ${styles.unavailable}`} data-testid="guest-error">
          <h1>{guestUiText(deniedLocale, 'error.title')}</h1>
          <p>{guestUiText(deniedLocale, 'error.body')}</p>
          <a href={pathname + searchStr} data-testid="guest-retry">
            {guestUiText(deniedLocale, 'error.retry')}
          </a>
        </section>
      </main>
    );
  }
  const { locale, locales, sourceLocale, sections } = guest.guest;
  const reviewed = sections.some((section) => section.provenance === 'reviewed');
  return (
    <main className={styles.shell} lang={locale}>
      <a
        className={styles.skipLink}
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
      <header className={styles.header}>
        <div className={styles.top}>
          <p className={styles.label}>{guestUiText(locale, 'label.guest')}</p>
          <LocaleSwitch locale={locale} locales={locales} pathname={pathname} />
        </div>
        <h1>{guest.guest.displayName}</h1>
        <GuestNav shareId={shareId} locale={locale} lang={lang} pathname={pathname} />
      </header>
      <div id="guest-content" className={styles.content} tabIndex={-1} data-testid="guest-content">
        {reviewed ? (
          <p className={styles.reviewed} data-testid="guest-reviewed">
            {guestUiText(locale, 'translated.notice')} ·{' '}
            <a href={guestLink(pathname, sourceLocale)} hrefLang={sourceLocale}>
              {guestUiText(locale, 'translated.showSource', {
                language: guestLocaleName(sourceLocale),
              })}
            </a>
          </p>
        ) : null}
        <Outlet />
      </div>
    </main>
  );
}

function GuestNav({
  shareId,
  locale,
  lang,
  pathname,
}: {
  shareId: string;
  locale: string;
  lang: string | undefined;
  pathname: string;
}) {
  const tabs = [
    { href: `/g/${shareId}`, label: guestUiText(locale, 'nav.home') },
    { href: `/g/${shareId}/guide`, label: guestUiText(locale, 'nav.guide') },
    { href: `/g/${shareId}/help`, label: guestUiText(locale, 'nav.help') },
  ];
  return (
    <nav className={styles.nav} aria-label={guestUiText(locale, 'nav.guide')}>
      {tabs.map((tab) => (
        // Full document loads keep the /g-scoped cookie on every request and re-check the link.
        <a key={tab.href} href={guestLink(tab.href, lang)} aria-current={pathname === tab.href ? 'page' : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

function LocaleSwitch({ locale, locales, pathname }: { locale: string; locales: readonly string[]; pathname: string }) {
  if (locales.length < 2) return null;
  const label = guestUiText(locale, 'nav.languages');
  const name = (code: string) => languageNames[code as keyof typeof languageNames] ?? guestLocaleName(code);
  return (
    <details className={styles.languages} data-testid="guest-locale-switch">
      <summary aria-label={`${label}: ${name(locale)}`}>{name(locale)}</summary>
      <ul aria-label={label}>
        {locales.map((code) => (
          <li key={code}>
            <a
              href={guestLink(pathname, code)}
              lang={code}
              hrefLang={code}
              aria-current={code === locale ? 'true' : undefined}
              data-testid={`guest-locale-${code}`}
            >
              {name(code)}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Identical markup for every denied state; the link's secret, if any, is read from the fragment
// client-side and exchanged for the host-checked session cookie.
function GuestOpen({ shareId, locale }: { shareId: string; locale: string }) {
  const [denied, setDenied] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), GUEST_OPEN_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

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
      <section className={`${styles.card} ${styles.unavailable}`} data-testid="guest-denied">
        <h1>{guestUiText(locale, 'denied.title')}</h1>
        <p>{guestUiText(locale, 'denied.body')}</p>
      </section>
    );
  }
  return <GuestOpening locale={locale} slow={slow} />;
}
