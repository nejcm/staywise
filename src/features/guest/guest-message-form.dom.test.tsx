// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestMessageForm } from './guest-message-form';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('guest message form interaction', () => {
  it('focuses the error summary, then the field its link points to', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ state: 'invalid', fields: { body: 'message_required' } }, { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<GuestMessageForm shareId="share-1" locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    const summary = await screen.findByTestId('guest-message-summary');
    expect(document.activeElement).toBe(summary);
    await user.click(screen.getByRole('link', { name: 'Write your message.' }));
    expect(document.activeElement).toBe(document.getElementById('guest-message-body'));
  });

  it('keeps the typed text and shows a notice when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
    const user = userEvent.setup();
    render(<GuestMessageForm shareId="share-1" locale="en" />);

    await user.type(screen.getByRole('textbox', { name: /message/i }), 'Where is the key?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Your message could not be sent. Please try again.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement).value).toBe('Where is the key?');
  });
});
