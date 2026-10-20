import type { ReactNode } from 'react';
import styles from './toast.module.css';

export function Toast({ testId, tone, children }: { testId: string; tone?: 'error'; children: ReactNode }) {
  return (
    <p role="status" className={tone ? `${styles.toast} ${styles.error}` : styles.toast} data-testid={testId}>
      {children}
    </p>
  );
}
