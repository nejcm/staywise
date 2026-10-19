import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { signOut } from '../features/host/host-fns';
import { Mark } from './mark';

export function SignOutButton({ className }: { className?: string }) {
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
    <button type="button" className={className} onClick={logout} disabled={busy} data-testid="host-signout">
      Sign out
    </button>
  );
}

export function HostBar() {
  return (
    <header className="topbar">
      <Link to="/host" className="mark">
        <Mark />
      </Link>
      <nav aria-label="Workspace">
        <Link to="/host" activeOptions={{ exact: true }}>
          Properties
        </Link>
        <Link to="/privacy">Privacy</Link>
      </nav>
      <SignOutButton className="quiet" />
    </header>
  );
}
