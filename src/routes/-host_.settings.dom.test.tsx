// @vitest-environment happy-dom
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { getHostAuthState, mfaUnenroll, mfaVerify, restartEnrollment } from '../features/host/host-fns';
import { getHostSettings, saveHostSettings } from '../features/host/settings-fns';
import { builtInHostSettings, type HostSettings } from '../features/host/settings.server';

vi.mock('../features/host/host-fns', () => ({
  getHostAuthState: vi.fn(),
  mfaUnenroll: vi.fn(),
  mfaVerify: vi.fn(),
  restartEnrollment: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../features/host/settings-fns', () => ({ getHostSettings: vi.fn(), saveHostSettings: vi.fn() }));

const timeZones = ['Europe/Ljubljana', 'UTC'];

function loadSettings(settings: HostSettings | null) {
  vi.mocked(getHostSettings).mockResolvedValue({
    email: 'host@example.test',
    settings: settings ?? builtInHostSettings,
    saved: settings !== null,
    timeZones,
  });
}

async function renderSettings() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/host/settings'] }) });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByTestId('settings-form');
}

function browserZone(timeZone: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone };
  });
}

beforeEach(() => {
  vi.mocked(getHostAuthState)
    .mockReset()
    .mockResolvedValue({ state: 'workspace', totpFactorIds: ['f1'] });
  vi.mocked(saveHostSettings).mockReset();
  vi.mocked(mfaUnenroll).mockReset();
  loadSettings(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('host settings defaults form', () => {
  it('suggests the browser time zone without saving it', async () => {
    browserZone('Europe/Ljubljana');
    await renderSettings();
    await waitFor(() =>
      expect((screen.getByTestId('settings-timezone') as HTMLSelectElement).value).toBe('Europe/Ljubljana'),
    );
    expect(screen.getByTestId('settings-timezone-hint')).toBeTruthy();
    expect(saveHostSettings).not.toHaveBeenCalled();
  });

  it('keeps a saved time zone instead of suggesting the browser one', async () => {
    browserZone('Europe/Ljubljana');
    loadSettings({ ...builtInHostSettings, timezone: 'UTC' });
    await renderSettings();
    expect((screen.getByTestId('settings-timezone') as HTMLSelectElement).value).toBe('UTC');
    expect(screen.queryByTestId('settings-timezone-hint')).toBeNull();
  });

  it('saves the parsed defaults with empty fields cleared', async () => {
    browserZone('UTC');
    vi.mocked(saveHostSettings).mockResolvedValue({ ok: true });
    await renderSettings();
    await userEvent.selectOptions(screen.getByTestId('settings-locale'), 'de');
    await userEvent.click(screen.getByTestId('settings-enabled-en'));
    await userEvent.type(screen.getByTestId('settings-contactPhone'), '+38641234567');
    await userEvent.click(screen.getByTestId('property-theme-alpine'));
    await userEvent.click(screen.getByTestId('settings-save'));
    expect(saveHostSettings).toHaveBeenCalledWith({
      data: {
        theme: 'alpine',
        sourceLocale: 'de',
        enabledLocales: ['en'],
        timezone: 'UTC',
        contactPhone: '+38641234567',
        answerFrom: '',
        answerTo: '',
        checkinTime: '',
        checkoutTime: '',
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId('settings-save-status').textContent).toBe(
        'Saved. New properties start with these values.',
      ),
    );
  });

  it('shows field errors and does not save unpaired answering hours', async () => {
    await renderSettings();
    await userEvent.type(screen.getByTestId('settings-answerFrom'), '09:00');
    await userEvent.click(screen.getByTestId('settings-save'));
    expect(await screen.findByTestId('settings-answerTo-error')).toBeTruthy();
    expect(saveHostSettings).not.toHaveBeenCalled();
  });
});

describe('host settings two-step sign-in', () => {
  it('refreshes after removing the authenticator', async () => {
    vi.mocked(mfaUnenroll).mockResolvedValue({ ok: true } as never);
    await renderSettings();
    await userEvent.click(screen.getByTestId('host-remove-mfa'));
    expect(mfaUnenroll).toHaveBeenCalledWith({ data: { factorId: 'f1' } });
    await waitFor(() => expect(getHostAuthState).toHaveBeenCalledTimes(2));
  });

  it('shows an error and keeps two-step sign-in on for an error result', async () => {
    vi.mocked(mfaUnenroll).mockResolvedValue({ error: 'unexpected' });
    await renderSettings();
    await userEvent.click(screen.getByTestId('host-remove-mfa'));
    await waitFor(() =>
      expect(screen.getByTestId('host-message').textContent).toBe('Something went wrong. Try again.'),
    );
    expect(screen.getByTestId('host-message').className).toMatch(/error/);
    expect(screen.getByTestId('host-mfa-status').textContent).toMatch(/^On\./);
    expect(getHostAuthState).toHaveBeenCalledTimes(1);
  });

  it('enrolls inline from a fresh secret and refreshes after verifying', async () => {
    vi.mocked(getHostAuthState).mockResolvedValue({ state: 'workspace', totpFactorIds: [] });
    vi.mocked(restartEnrollment).mockResolvedValue({ factorId: 'f2', secret: 'SYNTHETICSECRET' });
    vi.mocked(mfaVerify).mockResolvedValue({ ok: true });
    await renderSettings();
    expect(screen.getByTestId('host-mfa-status').textContent).toMatch(/^Off\./);
    await userEvent.click(screen.getByTestId('host-enroll-start'));
    expect((await screen.findByTestId('host-secret')).textContent).toBe('SYNTHETICSECRET');
    await userEvent.type(screen.getByTestId('host-code'), '123456');
    await userEvent.click(screen.getByTestId('host-verify-submit'));
    expect(mfaVerify).toHaveBeenCalledWith({ data: { factorId: 'f2', code: '123456' } });
    await waitFor(() => expect(getHostAuthState).toHaveBeenCalledTimes(2));
  });
});
