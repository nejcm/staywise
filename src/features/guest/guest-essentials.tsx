import { Clock, KeyRound, MapPin, Phone, Wifi, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { QrSvg } from '../../components/qr-svg';
import { Toast } from '../../components/toast';
import { buttonClass } from '../../components/button';
import type { PropertyEssentials } from '../guide/guide.server';
import { answerHoursText, guestCategoryLabel, guestUiText, mapSearchUrl, type GuestUiKey } from './guest-ui';
import styles from './guest.module.css';

const essentialKeys: (keyof PropertyEssentials)[] = [
  'checkinTime',
  'checkoutTime',
  'wifiName',
  'wifiPassword',
  'keyboxCode',
];

type EssentialItem = {
  key: keyof PropertyEssentials;
  label: GuestUiKey;
  value: string | null;
  icon: LucideIcon;
  copy?: boolean;
};

function essentialItems(essentials: PropertyEssentials): EssentialItem[] {
  const { checkinTime: checkin, checkoutTime: checkout } = essentials;
  return [
    { key: 'wifiPassword', label: 'essentials.wifiPassword', value: essentials.wifiPassword, icon: Wifi, copy: true },
    { key: 'keyboxCode', label: 'essentials.keyboxCode', value: essentials.keyboxCode, icon: KeyRound },
    checkin && checkout
      ? { key: 'checkinTime', label: 'essentials.stay', value: `${checkin} · ${checkout}`, icon: Clock }
      : checkin
        ? { key: 'checkinTime', label: 'essentials.checkin', value: checkin, icon: Clock }
        : { key: 'checkoutTime', label: 'essentials.checkout', value: checkout, icon: Clock },
  ];
}

export function AddressLine({ address, locale, testId }: { address: string; locale: string; testId: string }) {
  return (
    <p className={styles.address} data-testid={testId}>
      <Icon icon={MapPin} /> {address} ·{' '}
      <a href={mapSearchUrl(address)} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-map`}>
        {guestUiText(locale, 'home.openMap')}
      </a>
    </p>
  );
}

export function AnswerHours({ essentials, locale }: { essentials: PropertyEssentials; locale: string }) {
  const { answerFrom, answerTo, timezone } = essentials;
  if (!answerFrom || !answerTo) return null;
  return <p data-testid="guest-answer-hours">{answerHoursText(locale, answerFrom, answerTo, timezone)}</p>;
}

export function CallStrip({
  phone,
  locale,
  text,
  variant,
  emergency = false,
  testId,
}: {
  phone: string | null;
  locale: string;
  text: GuestUiKey;
  variant: 'primary' | 'secondary';
  emergency?: boolean;
  testId: string;
}) {
  return (
    <div className={styles.urgent} data-testid={testId}>
      <span>
        {phone ? guestUiText(locale, text) : null}
        {emergency ? (
          <>
            {phone ? ' ' : null}
            {guestUiText(locale, 'help.emergencyNumber')} <a href="tel:112">112</a>
          </>
        ) : null}
      </span>
      {phone ? (
        <a className={buttonClass(variant)} href={`tel:${phone}`} data-testid={`${testId}-call`}>
          <Icon icon={Phone} />
          {guestUiText(locale, 'contact.call')}
        </a>
      ) : null}
    </div>
  );
}

// shortcut: assumes WPA/WPA2/WPA3 when a password is set (no security-type field); add one if hosts run WEP.
export function wifiQrPayload(name: string, password: string | null): string {
  const escape = (text: string) => text.replace(/[\\;,:"]/g, '\\$&');
  return password ? `WIFI:T:WPA;S:${escape(name)};P:${escape(password)};;` : `WIFI:T:nopass;S:${escape(name)};;`;
}

export function hasEssentials(essentials: PropertyEssentials): boolean {
  return essentialKeys.some((key) => essentials[key]);
}

export function ArrivalCard({
  essentials,
  locale,
  testId,
}: {
  essentials: PropertyEssentials;
  locale: string;
  testId: string;
}) {
  if (!hasEssentials(essentials)) return null;
  const { wifiName } = essentials;
  return (
    <section className={styles.arrival} aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h2 id={`${testId}-title`}>
        {wifiName ? `${guestCategoryLabel(locale, 'wifi')} · ${wifiName}` : guestUiText(locale, 'essentials.title')}
      </h2>
      <EssentialsList essentials={essentials} locale={locale} />
    </section>
  );
}

export function EssentialsList({ essentials, locale }: { essentials: PropertyEssentials; locale: string }) {
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState('');
  const [showQr, setShowQr] = useState(false);
  const values = useRef<Partial<Record<keyof PropertyEssentials, HTMLElement | null>>>({});
  useEffect(() => setHydrated(true), []);

  async function copy(key: keyof PropertyEssentials, label: GuestUiKey, text: string) {
    // Cleared first so a repeated identical message is announced again by the live region.
    setMessage('');
    try {
      await navigator.clipboard.writeText(text);
      setMessage(guestUiText(locale, 'essentials.copied', { field: guestUiText(locale, label) }));
    } catch {
      const node = values.current[key];
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setMessage(guestUiText(locale, 'essentials.select'));
    }
  }

  return (
    <>
      <dl className={styles.essentials} data-testid="guest-essentials">
        {essentialItems(essentials).map(({ key, label, value, icon, copy: copyable }) => {
          if (!value) return null;
          return (
            <div key={key} className={styles[key]}>
              <dt>
                <Icon icon={icon} />
                {guestUiText(locale, label)}
              </dt>
              <dd>
                <span
                  ref={(node) => {
                    values.current[key] = node;
                  }}
                  data-testid={`guest-essential-${key}`}
                >
                  {value}
                </span>
                {hydrated && copyable ? (
                  <button
                    type="button"
                    className={styles.copy}
                    onClick={() => void copy(key, label, value)}
                    aria-label={`${guestUiText(locale, 'essentials.copy')}: ${guestUiText(locale, label)}`}
                    data-testid={`guest-copy-${key}`}
                  >
                    {guestUiText(locale, 'essentials.copy')}
                  </button>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
      {hydrated && essentials.wifiName ? (
        <div className={styles.wifiQr}>
          <button
            type="button"
            className={styles.copy}
            aria-expanded={showQr}
            aria-controls="guest-wifi-qr"
            onClick={() => setShowQr((open) => !open)}
            data-testid="guest-wifi-qr-toggle"
          >
            {guestUiText(locale, showQr ? 'essentials.hideQr' : 'essentials.showQr')}
          </button>
          <div id="guest-wifi-qr" hidden={!showQr}>
            {showQr ? (
              <>
                <QrSvg
                  value={wifiQrPayload(essentials.wifiName, essentials.wifiPassword)}
                  label={guestUiText(locale, 'essentials.qrLabel', { name: essentials.wifiName })}
                  className={styles.qr}
                  testId="guest-wifi-qr"
                />
                <p>{guestUiText(locale, 'essentials.qrHint')}</p>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <Toast testId="guest-essentials-toast">{message}</Toast>
    </>
  );
}
