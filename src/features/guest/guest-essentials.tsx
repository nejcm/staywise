import { useEffect, useRef, useState } from 'react';
import { Toast } from '../../components/toast';
import { buttonClass } from '../../components/button';
import type { PropertyEssentials } from '../guide/guide.server';
import { answerHoursText, guestUiText, mapSearchUrl, type GuestUiKey } from './guest-ui';
import styles from './guest.module.css';

const rows: { key: keyof PropertyEssentials; label: GuestUiKey; copy: boolean }[] = [
  { key: 'checkinTime', label: 'essentials.checkin', copy: false },
  { key: 'checkoutTime', label: 'essentials.checkout', copy: false },
  { key: 'wifiName', label: 'essentials.wifiName', copy: true },
  { key: 'wifiPassword', label: 'essentials.wifiPassword', copy: true },
  { key: 'keyboxCode', label: 'essentials.keyboxCode', copy: true },
];

export function AddressLine({ address, locale, testId }: { address: string; locale: string; testId: string }) {
  return (
    <p className={styles.address} data-testid={testId}>
      {address} ·{' '}
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
          {guestUiText(locale, 'contact.call')}
        </a>
      ) : null}
    </div>
  );
}

export function hasEssentials(essentials: PropertyEssentials): boolean {
  return rows.some((row) => essentials[row.key]);
}

export function EssentialsList({ essentials, locale }: { essentials: PropertyEssentials; locale: string }) {
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState('');
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
        {rows.map(({ key, label, copy: copyable }) => {
          const value = essentials[key];
          if (!value) return null;
          return (
            <div key={key}>
              <dt>{guestUiText(locale, label)}</dt>
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
                    className={buttonClass()}
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
      <Toast testId="guest-essentials-toast">{message}</Toast>
    </>
  );
}
