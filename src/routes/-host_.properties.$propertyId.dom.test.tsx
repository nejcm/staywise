// @vitest-environment happy-dom
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { getHostAuthState } from '../features/host/host-fns';
import {
  createSection,
  deleteProperty,
  getPropertyEditor,
  resyncAlertEmail,
  saveProperty,
  setGuidePublished,
} from '../features/guide/guide-fns';
import { getGuestLink, rotateGuestLink } from '../features/share/share-fns';
import { getInbox } from '../features/messages/messages-fns';
import {
  approveGuideTranslation,
  generateGuideTranslations,
  rejectGuideTranslation,
} from '../features/translation/translation-fns';
import type { GuideEditorData } from '../features/guide/guide.server';

vi.mock('../features/host/host-fns', () => ({ getHostAuthState: vi.fn() }));
vi.mock('../features/guide/guide-fns', () => ({
  createSection: vi.fn(),
  deleteProperty: vi.fn(),
  getPropertyEditor: vi.fn(),
  moveSectionOrder: vi.fn(),
  resyncAlertEmail: vi.fn(),
  saveProperty: vi.fn(),
  saveSection: vi.fn(),
  setGuidePublished: vi.fn(),
}));
vi.mock('../features/share/share-fns', () => ({
  createGuestLink: vi.fn(),
  disableGuestLink: vi.fn(),
  getGuestLink: vi.fn(),
  rotateGuestLink: vi.fn(),
}));
vi.mock('../features/messages/messages-fns', () => ({
  deleteInboxMessage: vi.fn(),
  getInbox: vi.fn(),
  markInboxHandled: vi.fn(),
  tagInboxAnswer: vi.fn(),
}));
vi.mock('../features/translation/translation-fns', () => ({
  approveGuideTranslation: vi.fn(),
  generateGuideTranslations: vi.fn(),
  rejectGuideTranslation: vi.fn(),
}));

const propertyId = '11111111-1111-4111-8111-111111111111';
const sectionId = '22222222-2222-4222-8222-222222222222';
const translationId = '33333333-3333-4333-8333-333333333333';
const generic = 'Something went wrong. Try again.';

const editor: GuideEditorData = {
  property: {
    id: propertyId,
    displayName: 'Synthetic villa',
    sourceLocale: 'en',
    enabledLocales: ['en', 'de'],
    published: false,
    alertEmail: null,
    theme: 'staywise',
    wifiName: null,
    wifiPassword: null,
    keyboxCode: null,
    checkinTime: null,
    checkoutTime: null,
    address: null,
    contactPhone: null,
    answerFrom: null,
    answerTo: null,
    timezone: 'Europe/Ljubljana',
  },
  timeZones: ['Europe/Ljubljana'],
  sections: [
    {
      id: sectionId,
      category: 'wifi',
      title: 'Wi-Fi',
      body: 'Router in the hall',
      visibility: 'guest',
      secretValue: null,
      displayOrder: 1,
      sourceRevision: 1,
      published: true,
      translations: [
        {
          id: translationId,
          locale: 'de',
          title: 'WLAN',
          body: 'Router im Flur',
          state: 'draft',
          sourceRevision: 1,
          stale: false,
          reviewedAt: null,
        },
      ],
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function renderEditor() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/host/properties/${propertyId}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByTestId('editor-property-name');
  return router;
}

function expectInvalidated() {
  return waitFor(() => expect(getHostAuthState).toHaveBeenCalledTimes(2));
}

async function expectToast(testId: string, text: string, failed: boolean) {
  await waitFor(() => expect(screen.getByTestId(testId).textContent).toBe(text));
  expect(screen.getByTestId(testId).className.includes('error')).toBe(failed);
}

async function acceptConfirm() {
  const dialog = await waitFor(() => {
    const open = document.querySelector('dialog[open]');
    if (!open) throw new Error('no open dialog');
    return open as HTMLElement;
  });
  await userEvent.click(within(dialog).getByTestId('confirm-accept'));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHostAuthState).mockResolvedValue({ state: 'workspace', totpFactorIds: [] });
  vi.mocked(getPropertyEditor).mockResolvedValue({ editor, gaps: [] } as never);
  vi.mocked(getGuestLink).mockResolvedValue({
    share: { link: { id: 'l1', createdAt: '2026-10-01T00:00:00.000Z' }, guidePublished: false },
  } as never);
  vi.mocked(getInbox).mockResolvedValue({ messages: [] } as never);
});
afterEach(cleanup);

describe('GuidePublish', () => {
  it('disables the button while publishing and refreshes on success', async () => {
    const pending = deferred<{ ok: true }>();
    vi.mocked(setGuidePublished).mockReturnValue(pending.promise as never);
    await renderEditor();
    const button = screen.getByTestId('guide-publish') as HTMLButtonElement;
    await userEvent.click(button);
    expect(setGuidePublished).toHaveBeenCalledWith({ data: { propertyId, published: true } });
    expect(button.disabled).toBe(true);
    pending.resolve({ ok: true });
    await expectInvalidated();
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('shows the generic error for an error result', async () => {
    vi.mocked(setGuidePublished).mockResolvedValue({ error: 'unexpected' } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('guide-publish'));
    await expectToast('guide-status-message', generic, true);
    expect(getHostAuthState).toHaveBeenCalledTimes(1);
  });

  it('shows the generic error and re-enables the button on rejection', async () => {
    vi.mocked(setGuidePublished).mockRejectedValue(new Error('network'));
    await renderEditor();
    const button = screen.getByTestId('guide-publish') as HTMLButtonElement;
    await userEvent.click(button);
    await expectToast('guide-status-message', generic, true);
    expect(button.disabled).toBe(false);
  });
});

describe('AddSectionForm', () => {
  it('creates a section, refreshes, and opens it', async () => {
    vi.mocked(createSection).mockResolvedValue({ sectionId } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('section-add'));
    await userEvent.click(screen.getByTestId('section-new-parking'));
    expect(createSection).toHaveBeenCalledWith({ data: { propertyId, category: 'parking' } });
    await expectInvalidated();
    await waitFor(() => expect(screen.queryByTestId('section-new-form')).toBeNull());
  });

  it('shows the generic error for an error result', async () => {
    vi.mocked(createSection).mockResolvedValue({ error: 'unexpected' } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('section-add'));
    await userEvent.click(screen.getByTestId('section-new-parking'));
    await expectToast('section-new-status', generic, true);
    expect(getHostAuthState).toHaveBeenCalledTimes(1);
  });
});

describe('PropertyDangerZone', () => {
  it('deletes after confirmation and leaves the editor', async () => {
    vi.mocked(deleteProperty).mockResolvedValue({ ok: true } as never);
    const router = await renderEditor();
    await userEvent.click(screen.getByTestId('property-delete'));
    expect(deleteProperty).not.toHaveBeenCalled();
    await acceptConfirm();
    expect(deleteProperty).toHaveBeenCalledWith({ data: { propertyId } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/host'));
  });

  it('shows the generic error for an error result', async () => {
    vi.mocked(deleteProperty).mockResolvedValue({ error: 'unexpected' } as never);
    const router = await renderEditor();
    await userEvent.click(screen.getByTestId('property-delete'));
    await acceptConfirm();
    await expectToast('property-delete-message', generic, true);
    expect(router.state.location.pathname).toBe(`/host/properties/${propertyId}`);
  });
});

describe('TranslationBlock', () => {
  it('approves a draft and refreshes', async () => {
    vi.mocked(approveGuideTranslation).mockResolvedValue({ ok: true } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('translation-approve-de'));
    expect(approveGuideTranslation).toHaveBeenCalledWith({
      data: { propertyId, translationId, sourceRevision: 1, title: 'WLAN', body: 'Router im Flur' },
    });
    await expectToast('translation-status-de', 'Translation approved.', false);
    await expectInvalidated();
  });

  it('shows the draft-specific error when rejecting fails', async () => {
    vi.mocked(rejectGuideTranslation).mockResolvedValue({ error: 'unexpected' } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('translation-reject-de'));
    expect(rejectGuideTranslation).toHaveBeenCalledWith({ data: { propertyId, translationId } });
    await expectToast('translation-status-de', 'Could not remove the draft. Try again.', true);
    expect(getHostAuthState).toHaveBeenCalledTimes(1);
  });
});

describe('ReadinessPanel', () => {
  it('drops an item once the saved property has it', async () => {
    vi.mocked(saveProperty).mockResolvedValue({ ok: true } as never);
    await renderEditor();
    expect(screen.getByTestId('readiness-checkinTime')).toBeTruthy();
    await userEvent.click(screen.getByTestId('readiness-checkinTime'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('essentials-checkinTime')));
    vi.mocked(getPropertyEditor).mockResolvedValue({
      editor: { ...editor, property: { ...editor.property, checkinTime: '15:00' } },
      gaps: [],
    } as never);
    await userEvent.click(screen.getByTestId('property-save'));
    await waitFor(() => expect(screen.queryByTestId('readiness-checkinTime')).toBeNull());
    expect(screen.getByTestId('readiness-checkoutTime')).toBeTruthy();
  });

  it('focuses the section and guest link targets', async () => {
    vi.mocked(getGuestLink).mockResolvedValue({ share: { link: null, guidePublished: false } } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('readiness-arrival'));
    await waitFor(() => expect(document.activeElement?.id).toBe('section-new-heading'));
    await userEvent.click(screen.getByTestId('readiness-link'));
    await waitFor(() => expect(document.activeElement?.id).toBe('guest-link-heading'));
  });
});

describe('GapPanel', () => {
  it('stays hidden without gaps', async () => {
    await renderEditor();
    expect(screen.queryByTestId('guide-gaps')).toBeNull();
  });

  it('adds a section in the asked-about category', async () => {
    vi.mocked(getPropertyEditor).mockResolvedValue({
      editor,
      gaps: [
        { category: 'parking', asked: 3, lastAsked: '2026-10-20T10:00:00.000Z' },
        { category: null, asked: 1, lastAsked: '2026-10-19T10:00:00.000Z' },
      ],
    } as never);
    vi.mocked(createSection).mockResolvedValue({ error: 'unexpected' });
    await renderEditor();
    expect(screen.getByTestId('guide-gaps').textContent).toContain('Guests asked about Parking 3 times');
    await userEvent.click(screen.getByTestId('gap-add-parking'));
    expect(createSection).toHaveBeenCalledWith({ data: { propertyId, category: 'parking', fromGap: true } });
  });
});

describe('GuestLinkPanel', () => {
  it('shows a rotated secret once, until the next action replaces it', async () => {
    vi.mocked(rotateGuestLink).mockResolvedValue({ shareId: 'share-new', secret: 'SYNTHETIC-SECRET' } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('guest-link-rotate'));
    expect(rotateGuestLink).not.toHaveBeenCalled();
    await acceptConfirm();
    await expectToast(
      'guest-link-message',
      'New guest link ready. Share it now — for security it is never shown again.',
      false,
    );
    expect((screen.getByTestId('guest-link-url') as HTMLInputElement).value).toBe(
      `${window.location.origin}/g/share-new#SYNTHETIC-SECRET`,
    );
    expect(screen.getAllByTestId('guest-link-url')).toHaveLength(1);
    await expectInvalidated();
  });

  async function issue() {
    vi.mocked(rotateGuestLink).mockResolvedValue({ shareId: 'share-new', secret: 'SYNTHETIC-SECRET' } as never);
    const router = await renderEditor();
    await userEvent.click(screen.getByTestId('guest-link-rotate'));
    await acceptConfirm();
    await screen.findByTestId('guest-link-url');
    return router;
  }

  it('downloads the QR as an SVG blob', async () => {
    let blob: Blob | undefined;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
      blob = value as Blob;
      return 'blob:synthetic';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await issue();
    const path = screen.getByTestId('guest-qr').querySelector('path')!.getAttribute('d')!;
    await userEvent.click(screen.getByTestId('guest-qr-download'));
    expect(blob?.type).toBe('image/svg+xml');
    const svg = await blob!.text();
    expect(svg).toContain(`<path d="${path}"`);
    create.mockRestore();
    revoke.mockRestore();
  });

  it('blocks leaving until the link is copied', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn() }, configurable: true });
    const router = await issue();
    void router.navigate({ to: '/host' });
    await waitFor(() =>
      expect(document.querySelector('dialog[open] h2')?.textContent).toBe('Leave without saving the link?'),
    );
    await userEvent.click(within(document.querySelector('dialog[open]') as HTMLElement).getByTestId('confirm-cancel'));
    expect(router.state.location.pathname).toBe(`/host/properties/${propertyId}`);
    await userEvent.click(screen.getByTestId('guest-link-copy'));
    await router.navigate({ to: '/privacy' });
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(router.state.location.pathname).toBe('/privacy');
  });

  it('shows the generic error for an error result and no link', async () => {
    vi.mocked(rotateGuestLink).mockResolvedValue({ error: 'unexpected' } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('guest-link-rotate'));
    await acceptConfirm();
    await expectToast('guest-link-message', generic, true);
    expect(screen.queryByTestId('guest-link-url')).toBeNull();
    expect(getHostAuthState).toHaveBeenCalledTimes(1);
  });
});

describe('TranslationPanel', () => {
  it.each([
    [{ error: 'unexpected' }, generic, true, false],
    [
      { state: 'blocked', sectionIds: [sectionId] },
      'Nothing was sent: these sections look like they contain secrets or contact details — Wi-Fi. Edit them, then generate again.',
      true,
      false,
    ],
    [{ state: 'provider_unavailable' }, 'Translation is not available right now, and nothing was sent.', true, false],
    [
      { state: 'generated', generated: 0, skipped: 0 },
      'Every enabled language is already translated for the current source text.',
      false,
      true,
    ],
    [
      { state: 'generated', generated: 1, skipped: 0 },
      'Generated 1 draft translation. Review each one under its section.',
      false,
      true,
    ],
    [
      { state: 'generated', generated: 2, skipped: 0 },
      'Generated 2 draft translations. Review each one under its section.',
      false,
      true,
    ],
    [{ state: 'nothing_to_do' }, 'Enable a guest language first, then generate.', true, false],
    [{ state: 'invalid_input' }, 'Enable a guest language first, then generate.', true, false],
  ])('maps %o to its message', async (result, text, failed, invalidates) => {
    vi.mocked(generateGuideTranslations).mockResolvedValue(result as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('translation-generate'));
    expect(generateGuideTranslations).toHaveBeenCalledWith({ data: { propertyId } });
    await expectToast('translation-message', text, failed);
    await waitFor(() => expect(getHostAuthState).toHaveBeenCalledTimes(invalidates ? 2 : 1));
  });

  it('shows the generic error on rejection', async () => {
    vi.mocked(generateGuideTranslations).mockRejectedValue(new Error('network'));
    await renderEditor();
    const button = screen.getByTestId('translation-generate') as HTMLButtonElement;
    await userEvent.click(button);
    await expectToast('translation-message', generic, true);
    expect(button.disabled).toBe(false);
  });
});

describe('PropertyForm and AlertPanel', () => {
  it('saves the property and refreshes', async () => {
    vi.mocked(saveProperty).mockResolvedValue({ ok: true } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('editor-basics'));
    await userEvent.click(screen.getByTestId('property-save'));
    expect(saveProperty).toHaveBeenCalledWith({
      data: expect.objectContaining({ propertyId, displayName: 'Synthetic villa' }),
    });
    expect(vi.mocked(saveProperty).mock.calls[0]?.[0]?.data).not.toHaveProperty('theme');
    await expectToast('property-save-status', 'Saved.', false);
    await expectInvalidated();
  });

  it('sends a changed guest page theme with the save', async () => {
    vi.mocked(saveProperty).mockResolvedValue({ ok: true } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('editor-basics'));
    expect((screen.getByTestId('property-theme-staywise') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('property-theme-coast').closest('[data-theme]')?.getAttribute('data-theme')).toBe(
      'coast',
    );
    await userEvent.click(screen.getByTestId('property-theme-coast'));
    await userEvent.click(screen.getByTestId('property-save'));
    expect(saveProperty).toHaveBeenCalledWith({ data: expect.objectContaining({ propertyId, theme: 'coast' }) });
  });

  it('shows the generic error when saving fails', async () => {
    vi.mocked(saveProperty).mockResolvedValue({ error: 'unexpected' } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('editor-basics'));
    await userEvent.click(screen.getByTestId('property-save'));
    await expectToast('property-save-status', generic, true);
    expect(getHostAuthState).toHaveBeenCalledTimes(1);
  });

  it('resyncs the alert address and refreshes', async () => {
    vi.mocked(resyncAlertEmail).mockResolvedValue({ alertEmail: 'host@example.test' } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('alert-email-resync'));
    expect(resyncAlertEmail).toHaveBeenCalledWith({ data: { propertyId } });
    await expectToast('alert-email-message', 'Alert address updated to your current sign-in address.', false);
    expect(screen.getByTestId('alert-email').textContent).toContain('host@example.test');
    await expectInvalidated();
  });

  it('shows the generic error when the resync fails', async () => {
    vi.mocked(resyncAlertEmail).mockResolvedValue({ error: 'unexpected' } as never);
    await renderEditor();
    await userEvent.click(screen.getByTestId('alert-email-resync'));
    await expectToast('alert-email-message', generic, true);
    expect(getHostAuthState).toHaveBeenCalledTimes(1);
  });
});
