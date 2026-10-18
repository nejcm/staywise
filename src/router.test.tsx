import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { routeTree } from './routeTree.gen';

describe('app routes', () => {
  it('server-renders the index page', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });

    await router.load();
    const html = renderToString(<RouterProvider router={router} />);

    expect(html).toContain('<h1>Staywise</h1>');
  });
});
