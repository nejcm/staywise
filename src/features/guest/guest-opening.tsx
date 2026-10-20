import { guestUiText } from './guest-ui';
import styles from './guest.module.css';

export const GUEST_OPEN_SLOW_MS = 8000;

export function GuestOpening({ locale, slow }: { locale: string; slow: boolean }) {
  return (
    <section
      className={`${styles.card} ${styles.unavailable}`}
      role="status"
      aria-busy={!slow}
      data-testid="guest-opening"
    >
      <h1>{guestUiText(locale, 'open.title')}</h1>
      <p>{guestUiText(locale, 'open.body')}</p>
      <div className={styles.skeleton} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {slow ? (
        <p data-testid="guest-open-slow">
          {guestUiText(locale, 'open.slow')}{' '}
          {/* A reload keeps the fragment secret in the address bar without it ever entering the markup. */}
          <button type="button" className={styles.retry} onClick={() => window.location.reload()}>
            {guestUiText(locale, 'error.retry')}
          </button>
        </p>
      ) : null}
      <noscript>
        <p>{guestUiText(locale, 'open.noscript')}</p>
      </noscript>
    </section>
  );
}
