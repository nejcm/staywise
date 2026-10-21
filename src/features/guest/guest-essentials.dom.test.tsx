// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressLine, EssentialsList, hasEssentials } from './guest-essentials';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const essentials = {
  checkinTime: '15:00',
  checkoutTime: null,
  wifiName: 'SyntheticNet',
  wifiPassword: 'synthetic-pass',
  keyboxCode: null,
} as never;

describe('essentials', () => {
  it('reports whether any essential is set', () => {
    expect(hasEssentials(essentials)).toBe(true);
    expect(hasEssentials({} as never)).toBe(false);
  });

  it('renders only the set rows and a copy button for copyable ones', async () => {
    render(<EssentialsList essentials={essentials} locale="en" />);
    expect(screen.getByTestId('guest-essential-wifiPassword').textContent).toBe('synthetic-pass');
    expect(screen.queryByTestId('guest-essential-keyboxCode')).toBeNull();
    expect(await screen.findByTestId('guest-copy-wifiPassword')).toBeTruthy();
    expect(screen.queryByTestId('guest-copy-checkinTime')).toBeNull();
  });

  it('copies to the clipboard and announces it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<EssentialsList essentials={essentials} locale="en" />);
    await user.click(await screen.findByTestId('guest-copy-wifiPassword'));
    expect(writeText).toHaveBeenCalledWith('synthetic-pass');
    expect((await screen.findByRole('status')).textContent).toMatch(/copied/i);
  });

  it('falls back to selecting the text when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<EssentialsList essentials={essentials} locale="en" />);
    await user.click(await screen.findByTestId('guest-copy-wifiPassword'));
    expect((await screen.findByRole('status')).textContent).not.toMatch(/copied/i);
    expect(window.getSelection()?.toString()).toBe('synthetic-pass');
  });

  it('links the address to a map search that opens safely', () => {
    render(<AddressLine address="Main St 1" locale="en" testId="addr" />);
    const link = screen.getByTestId('addr-map');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('href')).toContain('Main%20St%201');
  });
});
