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

export function HostShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.side}>
        <Link to="/host" className={styles.brand}>
          <Mark />
        </Link>
        <nav aria-label="Workspace" className={styles.nav}>
          <Link to="/host" activeOptions={{ exact: true }}>
            Properties
          </Link>
          <Link to="/privacy">Privacy notice</Link>
        </nav>
        <div className={styles.foot}>
          <SignOutButton variant="ghost" />
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
