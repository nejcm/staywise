import { withOwnerContext } from './db.server';
import { appEnv, serverEnv } from './env.server';
import { logEvent } from './log.server';

const browsers: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const systems: [RegExp, string][] = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac(?:intosh| OS X)\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const userAgentMax = 512;
const geoHeaderMax = 2048;
const cityMax = 80;

// Only a label from the fixed vocabulary above is stored, never the User-Agent itself.
export function deviceLabel(userAgent: string | null): string {
  const ua = (userAgent ?? '').slice(0, userAgentMax);
  const browser = browsers.find(([pattern]) => pattern.test(ua))?.[1];
  const system = systems.find(([pattern]) => pattern.test(ua))?.[1];
  if (!browser && !system) return 'Unknown device';
  if (!system) return browser!;
  return `${browser ?? 'Browser'} on ${system}`;
}

export type SignInPlace = { countryCode: string | null; city: string | null };

// Netlify sets `x-nf-geo` to base64 JSON ({ city, country: { code, name }, ... }); absent locally.
export function placeFromGeoHeader(value: string | null): SignInPlace {
  const none = { countryCode: null, city: null };
  if (!value || value.length > geoHeaderMax) return none;
  let geo: unknown;
  try {
    geo = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return none;
  }
  if (typeof geo !== 'object' || geo === null) return none;
  const { country, city } = geo as { country?: { code?: unknown }; city?: unknown };
  const code = typeof country === 'object' && country !== null ? country.code : undefined;
  const cleanCity =
    typeof city === 'string'
      ? Array.from(
          city
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
          .slice(0, cityMax)
          .join('')
          .trim()
      : '';
  return {
    countryCode: typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null,
    city: cleanCity || null,
  };
}

export type SignInContext = SignInPlace & { device: string };

export function signInContext(headers: Headers, trustGeo = serverEnv.trustNetlifyGeo): SignInContext {
  return {
    device: deviceLabel(headers.get('user-agent')),
    ...placeFromGeoHeader(trustGeo ? headers.get('x-nf-geo') : null),
  };
}

// New means no sign-in from this device and country in the 90-day audit window, so a first sign-in is new too.
export async function recordSignIn(
  userId: string,
  action: 'sign_in' | 'mfa_verified',
  { device, countryCode, city }: SignInContext,
) {
  try {
    await withOwnerContext(
      userId,
      (tx) => tx`
        insert into app.audit_events (actor_id, action, device_label, country_code, city, new_device)
        select ${userId}, ${action}, ${device}, ${countryCode}, ${city},
          not exists (
            select 1 from app.audit_events
            where actor_id = ${userId} and device_label = ${device} and country_code is not distinct from ${countryCode}
              and created_at > now() - interval '90 days'
          )
      `,
    );
  } catch {
    logEvent('audit_write_failed', { appEnv, status: 500 });
  }
}
