import { useEffect, useRef, useState } from 'react';
import { Toast } from '../../components/toast';
import { buttonClass } from '../../components/button';
import type { PropertyEssentials } from '../guide/guide.server';
import { guestUiText, type GuestUiKey } from './guest-ui';
import styles from './guest.module.css';

const rows: { key: keyof PropertyEssentials; label: GuestUiKey; copy: boolean }[] = [
  { key: 'checkinTime', label: 'essentials.checkin', copy: false },
  { key: 'checkoutTime', label: 'essentials.checkout', copy: false },
  { key: 'wifiName', label: 'essentials.wifiName', copy: true },
  { key: 'wifiPassword', label: 'essentials.wifiPassword', copy: true },
  { key: 'keyboxCode', label: 'essentials.keyboxCode', copy: true },
];

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
