// @vitest-environment happy-dom
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { getHostAuthState } from '../features/host/host-fns';
import { getHostSettings } from '../features/host/settings-fns';
import { submitSupportRequest } from '../features/host/support-fns';
import { builtInHostSettings } from '../features/host/settings.server';
import { sectionCategories } from '../features/guide/guide-validation';

vi.mock('../features/host/host-fns', () => ({ getHostAuthState: vi.fn(), signOut: vi.fn() }));
vi.mock('../features/host/settings-fns', () => ({ getHostSettings: vi.fn() }));
vi.mock('../features/host/support-fns', () => ({ submitSupportRequest: vi.fn() }));

beforeEach(() => {
  vi.mocked(getHostAuthState).mockResolvedValue({ state: 'workspace', totpFactorIds: [] });
  vi.mocked(getHostSettings).mockResolvedValue({
    email: 'host@example.test',
    settings: builtInHostSettings,
    saved: false,
    timeZones: ['UTC'],
    accountDeletion: true,
    supportEnabled: true,
  });
});
afterEach(cleanup);

describe('host guide page', () => {
  it('lists the steps and ideas for every section category', async () => {
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/host/help'] }) });
    await router.load();
    render(<RouterProvider router={router} />);
    expect((await screen.findByTestId('help-steps')).children.length).toBeGreaterThan(0);
    for (const category of sectionCategories) expect(screen.getByTestId(`help-ideas-${category}`)).toBeTruthy();
  });

  it('sends signed-out visitors to sign in', async () => {
    vi.mocked(getHostAuthState).mockResolvedValue({ state: 'signed_out' });
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/host/help'] }) });
    await router.load();
    expect(router.state.location.pathname).toBe('/auth/sign-in');
  });

  it('sends a support request and rejects an empty one', async () => {
    vi.mocked(submitSupportRequest).mockResolvedValue({ ok: true });
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/host/help'] }) });
    await router.load();
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByTestId('report-send'));
    expect((await screen.findByTestId('report-message-error')).textContent).toBeTruthy();
    expect(submitSupportRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('report-message'), { target: { value: 'Photo upload fails' } });
    fireEvent.click(screen.getByTestId('report-send'));
    await waitFor(() =>
      expect(submitSupportRequest).toHaveBeenCalledWith({ data: { kind: 'issue', message: 'Photo upload fails' } }),
    );
  });

  it('hides the form when support email is not configured', async () => {
    vi.mocked(getHostSettings).mockResolvedValue({
      email: 'host@example.test',
      settings: builtInHostSettings,
      saved: false,
      timeZones: ['UTC'],
      accountDeletion: true,
      supportEnabled: false,
    });
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/host/help'] }) });
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByTestId('help-steps');
    expect(screen.queryByTestId('report-form')).toBeNull();
  });
});
