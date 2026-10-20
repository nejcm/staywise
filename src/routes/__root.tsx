import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
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
    <main>
      <h1>Page not found</h1>
      <p>
        <a href="/">Go to Staywise</a>
      </p>
    </main>
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
