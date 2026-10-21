// @vitest-environment happy-dom
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { getHostAuthState, listOwnProperties, mfaUnenroll } from '../features/host/host-fns';

vi.mock('../features/host/host-fns', () => ({
  getHostAuthState: vi.fn(),
  listOwnProperties: vi.fn(),
  mfaEnroll: vi.fn(),
  mfaUnenroll: vi.fn(),
  mfaVerify: vi.fn(),
  restartEnrollment: vi.fn(),
}));

async function renderHost() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/host'] }) });
  await router.load();
  render(<RouterProvider router={router} />);
  return screen.findByTestId('host-remove-mfa');
}

beforeEach(() => {
  vi.mocked(getHostAuthState)
    .mockReset()
    .mockResolvedValue({ state: 'workspace', totpFactorIds: ['f1'] });
  vi.mocked(listOwnProperties).mockReset().mockResolvedValue({ error: 'unexpected' });
  vi.mocked(mfaUnenroll).mockReset();
});
afterEach(cleanup);

describe('host account two-step sign-in', () => {
  it('refreshes the workspace after removing the authenticator', async () => {
    vi.mocked(mfaUnenroll).mockResolvedValue({ ok: true } as never);
    const button = await renderHost();
    await userEvent.click(button);
    expect(mfaUnenroll).toHaveBeenCalledWith({ data: { factorId: 'f1' } });
    await waitFor(() => expect(getHostAuthState).toHaveBeenCalledTimes(2));
  });

  it('shows an error and keeps two-step sign-in on for an error result', async () => {
    vi.mocked(mfaUnenroll).mockResolvedValue({ error: 'unexpected' });
    await userEvent.click(await renderHost());
    const toast = await screen.findByText('Something went wrong. Try again.');
    expect(toast.className).toMatch(/error/);
    expect(screen.getByTestId('host-mfa-status').textContent).toMatch(/^On\./);
    expect(getHostAuthState).toHaveBeenCalledTimes(1);
  });

  it('shows an error and re-enables the button when the call rejects', async () => {
    vi.mocked(mfaUnenroll).mockRejectedValue(new Error('network'));
    const button = await renderHost();
    await userEvent.click(button);
    const toast = await screen.findByText('Something went wrong. Try again.');
    expect(toast.className).toMatch(/error/);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });
});
