import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { getGuestPage } from './guest-fns';
import { firstLine } from './guest-ui';

vi.mock('./guest-fns', () => ({ getGuestPage: vi.fn() }));

async function render(path: string, result: unknown): Promise<string> {
  vi.mocked(getGuestPage).mockResolvedValue(result as never);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

const guide = {
  state: 'guide',
  guest: {
    displayName: 'Synthetic villa',
    sourceLocale: 'en',
    locale: 'de',
    locales: ['de', 'en'],
    sections: [
      { category: 'wifi', title: 'WLAN', body: '\n  Netz: Villa\nPasswort am Router', fallback: false },
      { category: 'parking', title: 'Parking', body: 'Behind the house', fallback: true },
    ],
  },
};

describe('guest routes', () => {
  it('renders identical denied markup for every denial cause', async () => {
    const causes = [
      { state: 'denied', locale: 'en' },
      { error: 'unexpected', locale: 'en' },
      { error: 'invalid_input', locale: 'en' },
    ];
    const pages = await Promise.all(causes.map((cause) => render('/g/synthetic', cause)));
    expect(new Set(pages).size).toBe(1);
    expect(pages[0]).toContain('Opening your guide');
    for (const code of ['en', 'de', 'sl']) expect(pages[0]).toContain(`lang="${code}" hrefLang="${code}"`);
  });

  it('localizes the denied page from the fixed UI languages only', async () => {
    const html = await render('/g/synthetic?lang=sl', { state: 'denied', locale: 'sl' });
    expect(html).toMatch(/<main[^>]*lang="sl"/);
    expect(html).toContain('Odpiramo vaš vodič');
    expect(html).toMatch(/lang="sl"[^>]*aria-current="true"/);
    const remembered = await render('/g/synthetic', { state: 'denied', locale: 'de' });
    expect(remembered).toMatch(/<main[^>]*lang="de"/);
    expect(remembered).toContain('Ihr Gästeführer wird geöffnet');
    const unknown = await render('/g/synthetic?lang=fr', { state: 'denied', locale: 'en' });
    expect(unknown).toMatch(/<main[^>]*lang="en"/);
  });

  it('names each language in itself on the guest language sheet', async () => {
    const html = await render('/g/synthetic/guide?lang=de', guide);
    expect(html).toMatch(/<details[^>]*data-testid="guest-locale-switch"/);
    expect(html).toMatch(/lang="de"[^>]*aria-current="true"[^>]*>Deutsch</);
    expect(html).toMatch(/lang="en"[^>]*>English</);
  });

  it('renders one details block per guide section with its summary and fallback lang', async () => {
    const html = await render('/g/synthetic/guide?lang=de', guide);
    expect(html.match(/data-testid="guest-section"/g)).toHaveLength(2);
    expect(html.match(/<details>/g)).toHaveLength(2);
    expect(html).toMatch(/<h3>WLAN<\/h3><details><summary><span[^>]*>Netz: Villa<\/span><\/summary>/);
    expect(html).toMatch(/<h3 lang="en">Parking<\/h3>/);
    expect(html).toMatch(/<p[^>]*lang="en">Behind the house<\/p>/);
  });

  it('takes the first non-empty body line as the preview', () => {
    expect(firstLine('\n  first \nsecond')).toBe('first');
    expect(firstLine('')).toBe('');
  });

  it('puts ?lang on every language-switch link, including the source, and keeps the current ?lang on nav', async () => {
    const html = await render('/g/synthetic/guide?lang=de', guide);
    expect(html).toContain('href="/g/synthetic/guide?lang=en"');
    expect(html).toContain('href="/g/synthetic/help?lang=de"');
    const plain = await render('/g/synthetic/guide', guide);
    expect(plain).toContain('href="/g/synthetic/help"');
  });

  it('discloses the language cookie on the privacy page', async () => {
    expect(await render('/privacy', { state: 'denied' })).toContain('sw_lang');
  });
});
