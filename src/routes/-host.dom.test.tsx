// @vitest-environment happy-dom
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { getHostAuthState, getHostPage, listOwnProperties } from '../features/host/host-fns';
import { createProperty } from '../features/guide/guide-fns';

vi.mock('../features/host/host-fns', () => ({
  getHostAuthState: vi.fn(),
  getHostPage: vi.fn(),
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

// The server function gates and reads in one call; the test composes it from the per-read mocks.
async function composeHostPage() {
  const state = await getHostAuthState();
  if ('error' in state) return state;
  if (state.state !== 'workspace') return { state, workspace: null };
  const list = await listOwnProperties();
  return { state, workspace: 'error' in list ? null : list };
}

beforeEach(() => {
  vi.mocked(getHostPage)
    .mockReset()
    .mockImplementation(composeHostPage as never);
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

const day = 24 * 60 * 60_000;

function property(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    displayName: 'Synthetic loft',
    address: null,
    alertEmail: 'host@example.test',
    published: true,
    editedAt: new Date().toISOString(),
    sourceLocale: 'en',
    enabledLocales: ['en'],
    reviewedLocales: [],
    categories: [],
    unpublishedSections: 0,
    linkOn: true,
    linkCreatedAt: new Date(Date.now() - 40 * day).toISOString(),
    opens30d: 14,
    messages30d: 2,
    waiting: 0,
    ...overrides,
  };
}

async function renderWith(properties: ReturnType<typeof property>[]) {
  vi.mocked(listOwnProperties).mockResolvedValue({ email: 'Host@Example.test', properties, waiting: [] } as never);
  await renderHost();
}

describe('host alert drift', () => {
  it('flags a property whose alert address differs from the sign-in address', async () => {
    await renderWith([property({ alertEmail: 'old@example.test' })]);
    expect(screen.getByTestId('host-alert-drift').textContent).toBe(
      'Guest alerts for Synthetic loft go to old@example.test, not your sign-in address.',
    );
  });

  it('says when a property has no alert address', async () => {
    await renderWith([property({ alertEmail: null })]);
    expect(screen.getByTestId('host-alert-drift').textContent).toBe(
      'Guest alerts for Synthetic loft have no address set.',
    );
  });

  it('stays hidden when the addresses match ignoring case', async () => {
    await renderWith([property()]);
    expect(screen.queryByTestId('host-alert-drift')).toBeNull();
  });
});

describe('host guest activity', () => {
  it('labels the last 30 days of opens and messages', async () => {
    await renderWith([property()]);
    expect(screen.getByTestId('host-property-activity').textContent).toBe(
      'Opened 14 times · 2 messages in the last 30 days',
    );
  });

  it('nudges when an old link had no opens', async () => {
    await renderWith([property({ opens30d: 0 })]);
    expect(screen.getByText(/No guest opened Synthetic loft in 30 days/)).toBeTruthy();
  });

  it('does not nudge for a new link', async () => {
    await renderWith([property({ opens30d: 0, linkCreatedAt: new Date().toISOString() })]);
    expect(screen.queryByText(/No guest opened/)).toBeNull();
  });
});
