import type { ButtonHTMLAttributes } from 'react';
import styles from './button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
type Size = 'sm' | 'md';

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md') {
  return `${styles.button} ${styles[variant]}${size === 'sm' ? ` ${styles.sm}` : ''}`;
}

export function Button({
  variant,
  size,
  type,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  variant?: Variant;
  size?: Size;
  type: 'button' | 'submit';
}) {
  return <button type={type} className={buttonClass(variant, size)} {...props} />;
}
