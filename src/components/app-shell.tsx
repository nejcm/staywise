import { Link, useRouter } from '@tanstack/react-router';
import { CircleHelp, House, Shield, SlidersHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { signOut } from '../features/host/host-fns';
import styles from './app-shell.module.css';
import { Button } from './button';
import { Icon } from './icons';
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
            <Icon icon={House} />
            Properties
          </Link>
          <Link to="/host/settings" data-testid="host-settings-link">
            <Icon icon={SlidersHorizontal} />
            Settings
          </Link>
          <Link to="/host/help" data-testid="host-help-link">
            <Icon icon={CircleHelp} />
            Host guide
          </Link>
          <Link to="/privacy">
            <Icon icon={Shield} />
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
