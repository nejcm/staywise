import type { ReactNode } from 'react';
import styles from './toast.module.css';

export function Toast({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p role="status" className={styles.toast} data-testid={testId}>
      {children}
    </p>
  );
}
