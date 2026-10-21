import { Link, useRouter } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { signOut } from '../features/host/host-fns';
import styles from './app-shell.module.css';
import { Button } from './button';
import { Mark } from './mark';

export function SignOutButton({ variant }: { variant?: 'ghost' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await signOut({ data: {} });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant={variant} onClick={logout} disabled={busy} data-testid="host-signout">
      Sign out
    </Button>
  );
}

export function HostShell({ email, children }: { email?: string | null; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.side}>
        <Link to="/host" className={styles.brand}>
          <Mark />
        </Link>
        <nav aria-label="Workspace" className={styles.nav}>
          <Link to="/host" activeOptions={{ exact: true }}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11 12 4l9 7M5 10v10h14V10" />
            </svg>
            Properties
          </Link>
          <Link to="/privacy">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
            </svg>
            Privacy notice
          </Link>
        </nav>
        <div className={styles.foot}>
          {email ? (
            <p className={styles.account} data-testid="host-account-email">
              <span aria-hidden="true" className={styles.avatar}>
                {email.slice(0, 2).toUpperCase()}
              </span>
              <span className={styles.email}>{email}</span>
            </p>
          ) : null}
          <SignOutButton variant="ghost" />
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
