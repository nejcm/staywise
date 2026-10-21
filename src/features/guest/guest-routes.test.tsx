import { readFileSync } from 'node:fs';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { getGuestPage } from './guest-fns';
import { firstLine, guestUiText, messageRetentionDays } from './guest-ui';

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
      { category: 'wifi', title: 'WLAN', body: '\n  Netz: Villa\nPasswort am Router', provenance: 'reviewed' },
      { category: 'parking', title: 'Parking', body: 'Behind the house', provenance: 'fallback' },
    ],
    essentials: {
      wifiName: 'SyntheticNet',
      wifiPassword: 'SYNTHETIC-PASS',
      keyboxCode: '4821',
      checkinTime: '15:00',
      checkoutTime: null,
      address: 'Cesta svobode 12 & 3/A, Bled',
      contactPhone: '+38641234567',
      answerFrom: '22:00',
      answerTo: '02:00',
      timezone: 'Europe/Ljubljana',
    },
  },
};

describe('guest routes', () => {
  it('renders identical denied markup for every denial cause', async () => {
    const causes = [
      { state: 'denied', locale: 'en' },
      { state: 'denied', locale: 'en', cause: 'invalid-session' },
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

  it('lists guide sections as links to one page each, with excerpt and fallback lang', async () => {
    const html = await render('/g/synthetic/guide?lang=de', guide);
    expect(html.match(/data-testid="guest-section"/g)).toHaveLength(2);
    expect(html).toMatch(
      /href="\/g\/synthetic\/guide\/1\?lang=de"[^>]*><span><strong>WLAN<\/strong><small>Netz: Villa<\/small>/,
    );
    expect(html).toMatch(/href="\/g\/synthetic\/guide\/2\?lang=de"[^>]*><span lang="en"><strong>Parking</);
  });

  it('renders one section per page with position, pager and fallback lang', async () => {
    const html = await render('/g/synthetic/guide/2?lang=de', guide);
    expect(html).toContain('2 von 2');
    expect(html).toMatch(/<h1[^>]*lang="en">Parking<\/h1>/);
    expect(html).toMatch(/<p[^>]*lang="en">Behind the house<\/p>/);
    expect(html).toContain('data-testid="guest-fallback"');
    expect(html).toMatch(/href="\/g\/synthetic\/guide\/1\?lang=de" rel="prev"/);
    expect(html).not.toContain('rel="next"');
    for (const index of ['0', '3', 'x']) {
      const missing = await render(`/g/synthetic/guide/${index}`, guide);
      expect(missing).toContain('data-testid="guest-section-missing"');
      expect(missing).not.toMatch(/von 2/);
    }
  });

  it('server-renders essentials as selectable text with no Copy button before hydration', async () => {
    const html = await render('/g/synthetic?lang=de', guide);
    expect(html).toMatch(/<dl[^>]*data-testid="guest-essentials"/);
    expect(html).toContain('SYNTHETIC-PASS');
    expect(html).toContain('4821');
    expect(html).toContain('15:00');
    expect(html).not.toContain('guest-copy-');
    expect(html).not.toContain('Check-out');
  });

  it('shows the address with an outbound OpenStreetMap link and hides it when absent', async () => {
    const html = await render('/g/synthetic?lang=de', guide);
    expect(html).toContain('Cesta svobode 12 &amp; 3/A, Bled');
    expect(html).toContain(
      'href="https://www.openstreetmap.org/search?query=Cesta%20svobode%2012%20%26%203%2FA%2C%20Bled" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).not.toMatch(/<iframe|<img/);
    const bare = await render('/g/synthetic?lang=de', {
      ...guide,
      guest: { ...guide.guest, essentials: { ...guide.guest.essentials, address: null } },
    });
    expect(bare).not.toContain('guest-home-address');
    expect(bare).not.toContain('openstreetmap');
  });

  it('shows a decorative host initial from the property name', async () => {
    const html = await render('/g/synthetic?lang=de', guide);
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*data-testid="guest-host-initial">S<\/span>/);
  });

  it('offers Call and overnight answering hours on Home and an urgent strip on Help', async () => {
    const home = await render('/g/synthetic', { ...guide, guest: { ...guide.guest, locale: 'en' } });
    expect(home).toMatch(/href="tel:\+38641234567"[^>]*data-testid="guest-home-call"/);
    expect(home).toContain('Usually answers from 22:00 to 02:00 the next day, Europe/Ljubljana time.');
    const help = await render('/g/synthetic/help', { ...guide, guest: { ...guide.guest, locale: 'en' } });
    expect(help).toContain('Locked out or urgent? Call instead.');
    expect(help).toContain('href="tel:112"');
    expect(help).toMatch(/href="tel:\+38641234567"[^>]*data-testid="guest-help-urgent-call"/);
    const silent = await render('/g/synthetic/help', {
      ...guide,
      guest: { ...guide.guest, essentials: { ...guide.guest.essentials, contactPhone: null } },
    });
    expect(silent).toContain('href="tel:112"');
    expect(silent).not.toContain('tel:+');
    expect(silent).not.toContain('Locked out or urgent?');
  });

  it('names the copied field in the announcement', () => {
    expect(guestUiText('en', 'essentials.copied', { field: guestUiText('en', 'essentials.wifiPassword') })).toBe(
      'Wi-Fi password copied.',
    );
    expect(guestUiText('de', 'essentials.copied', { field: 'WLAN-Passwort' })).toBe('WLAN-Passwort kopiert.');
  });

  it('never renders essentials on denied or error pages', async () => {
    for (const result of [
      { state: 'denied', locale: 'en' },
      { state: 'error', locale: 'en' },
    ]) {
      const html = await render('/g/synthetic', result);
      expect(html).not.toContain('guest-essentials');
      expect(html).not.toContain('SYNTHETIC-PASS');
      expect(html).not.toContain('38641234567');
      expect(html).not.toContain('tel:');
    }
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

  it('shows the reviewed-translation banner linking to the source language with ?lang', async () => {
    const html = await render('/g/synthetic/guide?lang=de', guide);
    expect(html).toContain('Übersetzt, vom Gastgeber geprüft');
    expect(html).toMatch(
      /data-testid="guest-reviewed"[^]*href="\/g\/synthetic\/guide\?lang=en"[^>]*>English anzeigen</,
    );
    const untranslated = { ...guide, guest: { ...guide.guest, sections: [guide.guest.sections[1]] } };
    expect(await render('/g/synthetic/guide?lang=de', untranslated)).not.toContain('guest-reviewed');
  });

  it('renders a localized retry page for server errors without property data', async () => {
    const html = await render('/g/synthetic/guide?lang=de', { state: 'error', locale: 'de' });
    expect(html).toMatch(/<main[^>]*lang="de"/);
    expect(html).toContain('data-testid="guest-error"');
    expect(html).toMatch(/href="\/g\/synthetic\/guide\?lang=de"[^>]*>Erneut versuchen</);
    expect(html).not.toContain('guest-denied');
    expect(html).not.toContain('guest-opening');
    expect(html).not.toContain('Synthetic villa');
    expect(html).not.toMatch(/mailto:|tel:/);
  });

  it('discloses the language cookie on the privacy page', async () => {
    expect(await render('/privacy', { state: 'denied' })).toContain('sw_lang');
  });

  it('shows the localized privacy panel on Help with the shared retention period', async () => {
    const help = await render('/g/synthetic/help', guide);
    for (const key of ['help.privacy.sent', 'help.privacy.seen', 'form.noReply'] as const) {
      expect(help).toContain(guestUiText('de', key));
    }
    expect(help).toContain(`nach ${messageRetentionDays} Tagen automatisch gelöscht`);
    expect(await render('/privacy', { state: 'denied' })).toContain(
      `deleted <!-- -->${messageRetentionDays}<!-- --> days after receipt`,
    );
  });

  it('keeps the retention SQL in step with the disclosed period', () => {
    const sql = readFileSync('supabase/migrations/20261019170000_phase7d_auth_limits.sql', 'utf8');
    expect(sql).toContain(`v_event_cutoff timestamptz := p_now - interval '${messageRetentionDays} days'`);
    expect(sql).toContain('delete from app.guest_messages where created_at < v_event_cutoff');
  });
});
