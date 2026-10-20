import type { ReactNode } from 'react';
import styles from './field.module.css';

export function Field({
  label,
  error,
  errorId,
  errorTestId,
  children,
}: {
  label: ReactNode;
  error?: ReactNode;
  errorId?: string;
  errorTestId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
        {children}
      </label>
      {error ? (
        <p id={errorId} role="alert" className={styles.error} data-testid={errorTestId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
