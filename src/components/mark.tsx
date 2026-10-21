import styles from './mark.module.css';

export function Mark({ name = 'staywise' }: { name?: string }) {
  return (
    <span className={styles.mark}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17.5 8.5L12 4.5L6.5 8.5V9.5Q6.5 11.5 9 11.5H15Q18 11.5 18 14.5V17Q18 20 15 20H6" />
      </svg>
      {name}
    </span>
  );
}
