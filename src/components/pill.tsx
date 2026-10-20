import type { ReactNode } from 'react';
import styles from './pill.module.css';

export function Pill({
  tone = 'neutral',
  testId,
  children,
}: {
  tone?: 'positive' | 'attention' | 'neutral' | 'accent';
  testId?: string;
  children: ReactNode;
}) {
  return (
    <span className={`${styles.pill} ${styles[tone]}`} data-testid={testId}>
      {children}
    </span>
  );
}
