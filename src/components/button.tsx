import type { ButtonHTMLAttributes } from 'react';
import styles from './button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';

export function buttonClass(variant: Variant = 'secondary') {
  return `${styles.button} ${styles[variant]}`;
}

export function Button({
  variant,
  type,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { variant?: Variant; type: 'button' | 'submit' }) {
  return <button type={type} className={buttonClass(variant)} {...props} />;
}
