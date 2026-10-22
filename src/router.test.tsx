import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { routeTree } from './routeTree.gen';

vi.mock('./features/host/host-fns', () => ({ getHostAuthState: vi.fn(async () => ({ state: 'signed_out' })) }));

describe('app routes', () => {
  it('server-renders the index page', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });

    await router.load();
    const html = renderToString(<RouterProvider router={router} />);

    expect(html).toMatch(/<h1[^>]*>.*staywise/);
  });
});
