import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { signOut } from '../features/host/host-fns';
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
      <SignOutButton variant="ghost" />
    </header>
  );
}
