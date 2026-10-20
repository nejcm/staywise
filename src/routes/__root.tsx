import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { buttonClass } from '../components/button';
import { Mark } from '../components/mark';
import styles from '../features/host/public.module.css';
import '@fontsource-variable/dm-sans';
import '../styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Staywise' },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link to="/">
          <Mark />
        </Link>
      </header>
      <main className={styles.split}>
        <section className={styles.hero}>
          <h1>Page not found</h1>
          <p>This address does not exist. Guest links only work with the full link your host sent.</p>
        </section>
        <div className={styles.card}>
          <p className="actions">
            <Link to="/" className={buttonClass('primary')}>
              Go to Staywise
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
