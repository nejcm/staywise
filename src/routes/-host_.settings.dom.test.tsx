// @vitest-environment happy-dom
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { deleteAccount, getHostAuthState, mfaUnenroll, mfaVerify, restartEnrollment } from '../features/host/host-fns';
import { getHostSettings, saveHostSettings } from '../features/host/settings-fns';
import { builtInHostSettings, type HostSettings } from '../features/host/settings.server';
import { createAgentToken, getAgentAccess, revokeAgentToken, revokeAllAgentTokens } from '../features/agent/agent-fns';

vi.mock('../features/host/host-fns', () => ({
  deleteAccount: vi.fn(),
  getHostAuthState: vi.fn(),
  mfaUnenroll: vi.fn(),
  mfaVerify: vi.fn(),
  restartEnrollment: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../features/host/settings-fns', () => ({ getHostSettings: vi.fn(), saveHostSettings: vi.fn() }));
vi.mock('../features/agent/agent-fns', () => ({
  createAgentToken: vi.fn(),
  getAgentAccess: vi.fn(),
  revokeAgentToken: vi.fn(),
  revokeAllAgentTokens: vi.fn(),
}));

const timeZones = ['Europe/Ljubljana', 'UTC'];

function loadSettings(settings: HostSettings | null, accountDeletion = true) {
  vi.mocked(getHostSettings).mockResolvedValue({
    email: 'host@example.test',
    settings: settings ?? builtInHostSettings,
    saved: settings !== null,
    timeZones,
    accountDeletion,
  });
}

let router: ReturnType<typeof createRouter>;

async function renderSettings() {
  router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/host/settings'] }) });
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
  vi.mocked(deleteAccount).mockReset();
  vi.mocked(getAgentAccess).mockReset().mockResolvedValue({ enabled: false });
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

describe('host settings account deletion', () => {
  it('enables deletion only for the typed account email and sends the fresh code', async () => {
    vi.mocked(deleteAccount).mockResolvedValue({ ok: true });
    await renderSettings();
    const button = screen.getByTestId('account-delete') as HTMLButtonElement;
    await userEvent.type(screen.getByTestId('account-delete-email'), 'other@example.test');
    expect(button.disabled).toBe(true);
    await userEvent.clear(screen.getByTestId('account-delete-email'));
    await userEvent.type(screen.getByTestId('account-delete-email'), 'Host@Example.test');
    await userEvent.type(screen.getByTestId('account-delete-code'), '123456');
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    expect(deleteAccount).toHaveBeenCalledWith({ data: { email: 'Host@Example.test', code: '123456' } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/auth/sign-in'));
    expect((await screen.findByTestId('signin-message')).textContent).toBe('Your account was deleted.');
  });

  it('asks for no code without an authenticator and explains a rejected code', async () => {
    vi.mocked(getHostAuthState).mockResolvedValue({ state: 'workspace', totpFactorIds: [] });
    vi.mocked(deleteAccount).mockResolvedValue({ error: 'invalid_code' });
    await renderSettings();
    expect(screen.queryByTestId('account-delete-code')).toBeNull();
    await userEvent.type(screen.getByTestId('account-delete-email'), 'host@example.test');
    await userEvent.click(screen.getByTestId('account-delete'));
    expect(deleteAccount).toHaveBeenCalledWith({ data: { email: 'host@example.test' } });
    await waitFor(() => expect(screen.getByTestId('account-delete-message').textContent).toMatch(/code did not work/));
    expect(router.state.location.pathname).toBe('/host/settings');
  });

  it('hides the form when the environment has no secret key', async () => {
    loadSettings(null, false);
    await renderSettings();
    expect(screen.queryByTestId('account-delete-form')).toBeNull();
    expect(screen.getByTestId('account-delete-zone').textContent).toMatch(/not available/);
  });
});

const propertyId = '00000000-0000-4000-8000-0000000000a1';
const activeGrant = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Claude Code laptop',
  scopes: ['read' as const],
  propertyName: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  expiresAt: '2026-10-31T09:00:00.000Z',
  lastUsedAt: '2026-10-20T08:00:00.000Z',
  clientLabel: 'claude-code/2.0',
};

function enableAgentAccess(grants = [activeGrant]) {
  vi.mocked(getAgentAccess).mockResolvedValue({
    enabled: true,
    endpoint: 'http://localhost:3000/mcp',
    grants,
    properties: [{ id: propertyId, name: 'Bled lakeside apartment' }],
  });
}

describe('host settings agent access', () => {
  it('is hidden while agent access is disabled', async () => {
    await renderSettings();
    expect(screen.queryByTestId('agent-access')).toBeNull();
  });

  it('lists active tokens with last use and client label', async () => {
    enableAgentAccess();
    await renderSettings();
    const grant = screen.getByTestId('agent-grant');
    expect(grant.textContent).toMatch(/Claude Code laptop/);
    expect(grant.textContent).toMatch(/last used 2026-10-20 by claude-code\/2\.0/);
    expect(grant.textContent).toMatch(/expires 2026-10-31/);
  });

  it('creates a restricted token and shows it once', async () => {
    enableAgentAccess([]);
    vi.mocked(createAgentToken).mockResolvedValue({ ok: true, token: `sw_pat_${'B'.repeat(43)}` });
    await renderSettings();
    await userEvent.type(screen.getByTestId('agent-token-name'), 'Cursor');
    await userEvent.selectOptions(screen.getByTestId('agent-token-property'), propertyId);
    await userEvent.selectOptions(screen.getByTestId('agent-token-days'), '7');
    await userEvent.click(screen.getByTestId('agent-scope-inbox:write'));
    await userEvent.click(screen.getByTestId('agent-token-create'));
    expect(createAgentToken).toHaveBeenCalledWith({
      data: { name: 'Cursor', scopes: ['read', 'inbox:write'], propertyId, days: 7 },
    });
    expect(((await screen.findByTestId('agent-token-value')) as HTMLInputElement).value).toBe(
      `sw_pat_${'B'.repeat(43)}`,
    );
    expect(screen.getByTestId('agent-status').textContent).toMatch(/shown only once/);
  });

  it('requires a name and at least one permission', async () => {
    enableAgentAccess([]);
    await renderSettings();
    await userEvent.click(screen.getByTestId('agent-scope-read'));
    await userEvent.click(screen.getByTestId('agent-token-create'));
    expect(await screen.findByText('Name the token.')).toBeTruthy();
    expect(screen.getByText('Choose at least one permission.')).toBeTruthy();
    expect(createAgentToken).not.toHaveBeenCalled();
  });

  it('revokes one token or all of them', async () => {
    enableAgentAccess();
    vi.mocked(revokeAgentToken).mockResolvedValue({ ok: true });
    vi.mocked(revokeAllAgentTokens).mockResolvedValue({ ok: true });
    await renderSettings();
    await userEvent.click(screen.getByTestId('agent-grant-revoke'));
    expect(revokeAgentToken).toHaveBeenCalledWith({ data: { grantId: activeGrant.id } });
    await waitFor(() => expect(screen.getByTestId('agent-status').textContent).toBe('Token revoked.'));
    await userEvent.click(screen.getByTestId('agent-grants-revoke-all'));
    expect(revokeAllAgentTokens).toHaveBeenCalledWith({ data: {} });
    await waitFor(() => expect(screen.getByTestId('agent-status').textContent).toBe('All tokens revoked.'));
  });
});
