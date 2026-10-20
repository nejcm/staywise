// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteInboxMessage, markInboxHandled, tagInboxAnswer } from '../messages/messages-fns';
import type { InboxMessage } from '../messages/messages.server';
import { InboxPanel } from './host-inbox';

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));
vi.mock('../messages/messages-fns', () => ({
  deleteInboxMessage: vi.fn(),
  markInboxHandled: vi.fn(),
  tagInboxAnswer: vi.fn(),
}));

const base: InboxMessage = {
  id: 'm1',
  kind: 'question',
  category: 'wifi',
  locale: 'en',
  body: 'Where is the router?',
  followUpEmail: 'guest@example.test',
  answerInGuide: null,
  state: 'new',
  createdAt: '2026-10-21T09:30:00.000Z',
  handledAt: null,
} as InboxMessage;

beforeEach(() => {
  invalidate.mockReset();
  vi.mocked(markInboxHandled).mockResolvedValue({ ok: true });
  vi.mocked(tagInboxAnswer).mockResolvedValue({ ok: true });
  vi.mocked(deleteInboxMessage).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('InboxPanel', () => {
  it('shows the unavailable and empty states', () => {
    const { rerender } = render(<InboxPanel propertyId="p1" messages={null} />);
    expect(screen.getByTestId('inbox-unavailable')).toBeTruthy();
    rerender(<InboxPanel propertyId="p1" messages={[]} />);
    expect(screen.getByTestId('inbox-empty')).toBeTruthy();
  });

  it('shows the message verbatim with an unverified reply address and the waiting count', () => {
    render(<InboxPanel propertyId="p1" messages={[base]} />);
    expect(screen.getByTestId('inbox-item-body').textContent).toBe('Where is the router?');
    expect(screen.getByTestId('inbox-item-email-unverified')).toBeTruthy();
    expect(screen.getByTestId('inbox-item-created').textContent).toBe('2026-10-21 09:30 UTC');
    expect(screen.getByText('1 waiting for you')).toBeTruthy();
  });

  it('marks handled, refreshes, and disables the action for handled messages', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InboxPanel propertyId="p1" messages={[base]} />);
    await user.click(screen.getByTestId('inbox-handle-m1'));
    expect(markInboxHandled).toHaveBeenCalledWith({ data: { propertyId: 'p1', messageId: 'm1' } });
    expect(invalidate).toHaveBeenCalled();

    rerender(<InboxPanel propertyId="p1" messages={[{ ...base, state: 'handled', handledAt: base.createdAt }]} />);
    expect((screen.getByTestId('inbox-handle-m1') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('All handled')).toBeTruthy();
  });

  it('tags whether the answer was in the guide', async () => {
    const user = userEvent.setup();
    render(<InboxPanel propertyId="p1" messages={[base]} />);
    await user.selectOptions(screen.getByTestId('inbox-answer-m1'), 'yes');
    expect(tagInboxAnswer).toHaveBeenCalledWith({ data: { propertyId: 'p1', messageId: 'm1', answerInGuide: true } });
  });

  it('shows a generic error notice when the action fails', async () => {
    vi.mocked(markInboxHandled).mockResolvedValue({ error: 'unexpected' });
    const user = userEvent.setup();
    render(<InboxPanel propertyId="p1" messages={[base]} />);
    await user.click(screen.getByTestId('inbox-handle-m1'));
    expect((await screen.findByTestId('inbox-notice')).textContent).toBe('Something went wrong. Try again.');
  });

  it('deletes only after the dialog is confirmed', async () => {
    const user = userEvent.setup();
    render(<InboxPanel propertyId="p1" messages={[base]} />);
    await user.click(screen.getByTestId('inbox-delete-m1'));
    await user.click(await within(document.body).findByTestId('confirm-cancel'));
    expect(deleteInboxMessage).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('inbox-delete-m1'));
    await user.click(await within(document.body).findByTestId('confirm-accept'));
    expect(deleteInboxMessage).toHaveBeenCalledWith({ data: { propertyId: 'p1', messageId: 'm1' } });
  });
});
