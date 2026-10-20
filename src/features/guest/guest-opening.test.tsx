import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuestOpening } from './guest-opening';
import { guestUiText } from './guest-ui';

describe('guest opening', () => {
  it('is a busy status without a retry until the slow timeout', () => {
    const html = renderToString(<GuestOpening locale="sl" slow={false} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('guest-open-slow');
  });

  it('offers a localized reload button, never a link, once slow', () => {
    const html = renderToString(<GuestOpening locale="sl" slow />);
    expect(html).toContain(guestUiText('sl', 'open.slow'));
    expect(html).toContain(`<button type="button"`);
    expect(html).toContain(guestUiText('sl', 'error.retry'));
    expect(html).not.toContain('href=');
    expect(html).not.toContain('#');
  });

  it('stops the shimmer under reduced motion', () => {
    const css = readFileSync(new URL('./guest.module.css', import.meta.url), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*\.skeleton span\s*{\s*animation: none;/);
  });
});
