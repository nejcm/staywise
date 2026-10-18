import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
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
import { copyProperty, createProperty, requestSetupSupport } from '../guide-fns';
import { collectFieldErrors, propertyFields } from '../guide-validation';

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
  const navigate = useNavigate();
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
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [createMessage, setCreateMessage] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [supportMessage, setSupportMessage] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = propertyFields.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      setCreateErrors(collectFieldErrors(parsed.error));
      setCreateMessage('Check the highlighted fields.');
      return;
    }
    setCreateErrors({});
    setCreateMessage('');
    setBusy(true);
    try {
      const result = await createProperty({ data: parsed.data });
      if ('error' in result) {
        setCreateMessage('Something went wrong. Try again.');
        return;
      }
      await navigate({ to: '/host/properties/$propertyId', params: { propertyId: result.propertyId } });
    } catch {
      setCreateMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(sourcePropertyId: string) {
    setCopyMessage('');
    setBusy(true);
    try {
      const result = await copyProperty({ data: { sourcePropertyId } });
      if ('error' in result) {
        setCopyMessage('Something went wrong. Try again.');
        return;
      }
      await navigate({ to: '/host/properties/$propertyId', params: { propertyId: result.propertyId } });
    } catch {
      setCopyMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function requestSupport() {
    setSupportMessage('');
    setBusy(true);
    try {
      const result = await requestSetupSupport({ data: {} });
      setSupportMessage(
        'error' in result ? 'Something went wrong. Try again.' : 'Request recorded for the pilot team.',
      );
    } catch {
      setSupportMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

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
      <form onSubmit={create} noValidate data-testid="host-create-form">
        <p>
          <label>
            Property name{' '}
            <input
              name="displayName"
              maxLength={120}
              required
              aria-invalid={Boolean(createErrors.displayName)}
              aria-describedby={createErrors.displayName ? 'create-name-error' : undefined}
              data-testid="host-create-name"
            />
          </label>
        </p>
        {createErrors.displayName ? (
          <p id="create-name-error" role="alert" data-testid="host-create-name-error">
            {createErrors.displayName}
          </p>
        ) : null}
        <p>
          <label>
            Guide language{' '}
            <input
              name="sourceLocale"
              defaultValue="en"
              maxLength={5}
              required
              title="Language tag like en or pt-BR"
              aria-invalid={Boolean(createErrors.sourceLocale)}
              aria-describedby={createErrors.sourceLocale ? 'create-locale-error' : undefined}
              data-testid="host-create-locale"
            />
          </label>
        </p>
        {createErrors.sourceLocale ? (
          <p id="create-locale-error" role="alert" data-testid="host-create-locale-error">
            {createErrors.sourceLocale}
          </p>
        ) : null}
        <p>
          <button type="submit" disabled={busy} data-testid="host-create-submit">
            Create property
          </button>{' '}
          <span role="status" data-testid="host-create-message">
            {createMessage}
          </span>
        </p>
      </form>
      {properties.length === 0 ? (
        <p data-testid="host-properties-empty">No properties yet.</p>
      ) : (
        <>
          <ul data-testid="host-properties">
            {properties.map((property: PropertySummary) => (
              <li key={property.id} data-testid="host-property">
                <Link
                  to="/host/properties/$propertyId"
                  params={{ propertyId: property.id }}
                  data-testid="host-property-name"
                >
                  {property.displayName}
                </Link>{' '}
                <span data-testid="host-property-status">{property.published ? '(published)' : '(draft)'}</span>{' '}
                <button
                  type="button"
                  onClick={() => duplicate(property.id)}
                  disabled={busy}
                  data-testid="host-property-copy"
                >
                  Make a copy
                </button>
              </li>
            ))}
          </ul>
          <p role="status" data-testid="host-copy-message">
            {copyMessage}
          </p>
        </>
      )}
      <p>
        <button type="button" onClick={requestSupport} disabled={busy} data-testid="host-support-request">
          Request setup support
        </button>{' '}
        <span role="status" data-testid="host-support-message">
          {supportMessage}
        </span>
      </p>
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
