export function Mark({ name = 'Staywise' }: { name?: string }) {
  return (
    <>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="var(--accent)" />
        <path
          d="M6 11.5 12 6.5l6 5M6 16.5c2 0 2-1.3 4-1.3s2 1.3 4 1.3 2-1.3 4-1.3"
          fill="none"
          stroke="#fff"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {name}
    </>
  );
}
