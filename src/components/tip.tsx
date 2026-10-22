import { ChevronDown, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './icons';
import styles from './tip.module.css';

export function Tip({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return (
    <details className={styles.tip} data-testid={testId}>
      <summary>
        <Icon icon={Lightbulb} />
        <span>{title}</span>
        <Icon icon={ChevronDown} className={styles.chevron} />
      </summary>
      {children}
    </details>
  );
}
