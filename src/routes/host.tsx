import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  getHostAuthState,
  listOwnProperties,
  mfaEnroll,
  mfaUnenroll,
  mfaVerify,
  restartEnrollment,
  signOut,
} from '../host-fns';

type PropertySummary = { id: string; displayName: string; published: boolean; createdAt: Date };

export const Route = createFileRoute('/host')({
  loader: async () => {
    const state = await getHostAuthState();
    if ('error' in state || state.state === 'signed_out') {
      throw redirect({ to: '/auth/sign-in' });
    }
    if (state.state !== 'workspace') {
      return { state, properties: [] as PropertySummary[] };
    }
    const list = await listOwnProperties();
    if ('error' in list) {
      throw redirect({ to: '/auth/sign-in' });
    }
    return { state, properties: list.properties as PropertySummary[] };
  },
  component: HostPage,
});

function HostPage() {
  const { state, properties } = Route.useLoaderData();
  const router = useRouter();
  const [factor, setFactor] = useState<{ factorId: string; secret: string | null } | null>(
    state.state === 'enroll' && state.factorId
      ? { factorId: state.factorId, secret: null }
      : state.state === 'verify'
        ? { factorId: state.factorId, secret: null }
        : null,
  );
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    setMessage('');
    try {
      const result = await mfaEnroll({ data: {} });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      setFactor({ factorId: result.factorId, secret: result.secret });
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setBusy(true);
    setMessage('');
    try {
      const result = await restartEnrollment({ data: {} });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        return;
      }
      setFactor({ factorId: result.factorId, secret: result.secret });
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factor) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await mfaVerify({ data: { factorId: factor.factorId, code } });
      if ('error' in result) {
        setMessage(
          result.error === 'invalid_code' ? 'That code did not match. Try again.' : 'Something went wrong. Try again.',
        );
        return;
      }
      setCode('');
      setFactor(null);
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function removeMfa(factorId: string) {
    setBusy(true);
    try {
      await mfaUnenroll({ data: { factorId } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await signOut({ data: {} });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  if (state.state !== 'workspace') {
    return (
      <main>
        <h1>Host workspace</h1>
        <p data-testid="host-state">{state.state === 'verify' ? 'verify' : 'enroll'}</p>
        <p>
          {state.state === 'verify'
            ? 'Enter the six-digit code from your authenticator app to continue.'
            : 'Set up an authenticator app. The host workspace stays locked until two-factor authentication is active.'}
        </p>
        {factor ? (
          <form onSubmit={verify} data-testid="host-verify-form">
            {factor.secret ? (
              <p>
                Add this secret to your authenticator app: <code data-testid="host-secret">{factor.secret}</code>
              </p>
            ) : state.state === 'enroll' ? (
              <p data-testid="host-enroll-interrupted">
                Enrollment was not finished. Enter a current code if the secret was already saved, or restart to get a
                new one.{' '}
                <button type="button" onClick={restart} disabled={busy} data-testid="host-enroll-start">
                  Restart enrollment
                </button>
              </p>
            ) : null}
            <label>
              Six-digit code
              <input
                inputMode="numeric"
                pattern="\d{6}"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                data-testid="host-code"
              />
            </label>
            <button type="submit" disabled={busy} data-testid="host-verify-submit">
              Verify
            </button>
          </form>
        ) : (
          <button type="button" onClick={startEnroll} disabled={busy} data-testid="host-enroll-start">
            Set up authenticator
          </button>
        )}
        <p data-testid="host-message" role="status">
          {message}
        </p>
        <button type="button" onClick={logout} disabled={busy} data-testid="host-signout">
          Sign out
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Host workspace</h1>
      <p data-testid="host-state">workspace</p>
      <h2>Properties</h2>
      {properties.length === 0 ? (
        <p data-testid="host-properties-empty">No properties yet.</p>
      ) : (
        <ul data-testid="host-properties">
          {properties.map((property: PropertySummary) => (
            <li key={property.id} data-testid="host-property">
              <span data-testid="host-property-name">{property.displayName}</span>{' '}
              {property.published ? '(published)' : '(draft)'}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => removeMfa(state.totpFactorIds[0] ?? '')}
        disabled={busy || state.totpFactorIds.length === 0}
        data-testid="host-remove-mfa"
      >
        Remove authenticator
      </button>
      <button type="button" onClick={logout} disabled={busy} data-testid="host-signout">
        Sign out
      </button>
    </main>
  );
}
