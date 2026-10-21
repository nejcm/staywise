import { useEffect, useRef, useState } from 'react';
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

type EssentialItem = { key: keyof PropertyEssentials; label: GuestUiKey; value: string | null; copy?: boolean };

function essentialItems(essentials: PropertyEssentials): EssentialItem[] {
  const { checkinTime: checkin, checkoutTime: checkout } = essentials;
  return [
    { key: 'wifiPassword', label: 'essentials.wifiPassword', value: essentials.wifiPassword, copy: true },
    { key: 'keyboxCode', label: 'essentials.keyboxCode', value: essentials.keyboxCode },
    checkin && checkout
      ? { key: 'checkinTime', label: 'essentials.stay', value: `${checkin} · ${checkout}` }
      : checkin
        ? { key: 'checkinTime', label: 'essentials.checkin', value: checkin }
        : { key: 'checkoutTime', label: 'essentials.checkout', value: checkout },
  ];
}

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
        {essentialItems(essentials).map(({ key, label, value, copy: copyable }) => {
          if (!value) return null;
          return (
            <div key={key} className={styles[key]}>
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
      <Toast testId="guest-essentials-toast">{message}</Toast>
    </>
  );
}

export function ChevronIcon({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'back' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
    </svg>
  );
}
