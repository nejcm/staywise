import { describe, expect, it, vi } from 'vitest';
import { withOwnerContext } from './db.server';
import { logEvent } from './log.server';
import { deviceLabel, placeFromGeoHeader, recordSignIn, signInContext } from './sign-in-context.server';

vi.mock('./db.server', () => ({ withOwnerContext: vi.fn() }));
vi.mock('./log.server', () => ({ logEvent: vi.fn() }));

const geo = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');

describe('deviceLabel', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome on Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Safari on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
      'Chrome on iOS',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
      'Firefox on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
      'Opera on Windows',
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome on ChromeOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 SomeBrowser/1.0', 'Browser on Linux'],
    ['Firefox/131.0', 'Firefox'],
    ['curl/8.10.1', 'Unknown device'],
    ['', 'Unknown device'],
    [null, 'Unknown device'],
  ])('labels %s as %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });

  it('never returns any part of an unrecognised User-Agent', () => {
    expect(deviceLabel('Evil‮/1.0 <script>')).toBe('Unknown device');
  });
});

describe('placeFromGeoHeader', () => {
  it('reads the country code and city from the Netlify header', () => {
    expect(placeFromGeoHeader(geo({ city: 'Ljubljana', country: { code: 'SI', name: 'Slovenia' } }))).toEqual({
      countryCode: 'SI',
      city: 'Ljubljana',
    });
  });

  it('is empty when the header is absent, garbage, or oversized', () => {
    const none = { countryCode: null, city: null };
    expect(placeFromGeoHeader(null)).toEqual(none);
    expect(placeFromGeoHeader('')).toEqual(none);
    expect(placeFromGeoHeader('%%%not-base64%%%')).toEqual(none);
    expect(placeFromGeoHeader(Buffer.from('{"city":').toString('base64'))).toEqual(none);
    expect(placeFromGeoHeader(geo('Ljubljana'))).toEqual(none);
    expect(placeFromGeoHeader(geo(null))).toEqual(none);
    expect(placeFromGeoHeader(geo({ city: 'x'.repeat(3000) }))).toEqual(none);
  });

  it('drops malformed fields and strips control and bidi characters from the city', () => {
    expect(placeFromGeoHeader(geo({ city: 42, country: { code: 'si' } }))).toEqual({ countryCode: null, city: null });
    expect(placeFromGeoHeader(geo({ city: '  San‮\u0007  Jose\n ', country: 'US' }))).toEqual({
      countryCode: null,
      city: 'San Jose',
    });
    expect(placeFromGeoHeader(geo({ city: '​‮', country: { code: 'DEU' } }))).toEqual({
      countryCode: null,
      city: null,
    });
    expect(placeFromGeoHeader(geo({ city: 'a'.repeat(200), country: { code: 'DE' } }))?.city).toHaveLength(80);
  });
});

describe('signInContext', () => {
  const headers = new Headers({
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'x-nf-geo': geo({ city: 'Ljubljana', country: { code: 'SI' } }),
  });

  it('ignores a geo header the runtime cannot vouch for', () => {
    expect(signInContext(headers, false)).toEqual({ device: 'Firefox on Linux', countryCode: null, city: null });
    expect(signInContext(headers)).toEqual({ device: 'Firefox on Linux', countryCode: null, city: null });
  });

  it('reads the place on a trusted Netlify runtime', () => {
    expect(signInContext(headers, true)).toEqual({ device: 'Firefox on Linux', countryCode: 'SI', city: 'Ljubljana' });
  });
});

describe('recordSignIn', () => {
  it('swallows an audit failure and logs only fixed fields', async () => {
    vi.mocked(withOwnerContext).mockRejectedValueOnce(new Error('synthetic Firefox/131.0 failure'));
    await expect(
      recordSignIn('owner-1', 'sign_in', { device: 'Firefox on Linux', countryCode: 'SI', city: 'Ljubljana' }),
    ).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledExactlyOnceWith('audit_write_failed', { appEnv: 'local', status: 500 });
  });
});
