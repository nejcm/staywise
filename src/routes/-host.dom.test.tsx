// @vitest-environment happy-dom
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { getHostAuthState, listOwnProperties } from '../features/host/host-fns';
import { createProperty } from '../features/guide/guide-fns';

vi.mock('../features/host/host-fns', () => ({
  getHostAuthState: vi.fn(),
  listOwnProperties: vi.fn(),
  mfaEnroll: vi.fn(),
}));
vi.mock('../features/guide/guide-fns', () => ({
  copyProperty: vi.fn(),
  createProperty: vi.fn(),
  requestSetupSupport: vi.fn(),
}));

async function renderHost() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/host'] }) });
  await router.load();
  render(<RouterProvider router={router} />);
  return screen.findByTestId('host-create-form');
}

beforeEach(() => {
  vi.mocked(getHostAuthState)
    .mockReset()
    .mockResolvedValue({ state: 'workspace', totpFactorIds: ['f1'] });
  vi.mocked(listOwnProperties).mockReset().mockResolvedValue({ error: 'unexpected' });
  vi.mocked(createProperty).mockReset();
});
afterEach(cleanup);

describe('host create property', () => {
  it('sends only the name, so the server applies the host settings', async () => {
    vi.mocked(listOwnProperties).mockResolvedValue({ properties: [], waiting: [] } as never);
    vi.mocked(createProperty).mockResolvedValue({ error: 'unexpected' });
    await renderHost();
    expect(screen.queryByTestId('host-create-locale')).toBeNull();
    await userEvent.type(screen.getByTestId('host-create-name'), 'Synthetic villa');
    await userEvent.click(screen.getByTestId('host-create-submit'));
    expect(createProperty).toHaveBeenCalledWith({ data: { displayName: 'Synthetic villa' } });
  });
});
