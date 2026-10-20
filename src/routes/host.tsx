import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import {
  getHostAuthState,
  listOwnProperties,
  mfaEnroll,
  mfaUnenroll,
  mfaVerify,
  restartEnrollment,
} from '../features/host/host-fns';
import { HostBar, SignOutButton } from '../components/app-shell';
import { Button } from '../components/button';
import { Field } from '../components/field';
import { Mark } from '../components/mark';
import { Pill } from '../components/pill';
import { Toast } from '../components/toast';
import { copyProperty, createProperty, requestSetupSupport } from '../features/guide/guide-fns';
import { collectFieldErrors, propertyFields } from '../features/guide/guide-validation';

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

  if (state.state !== 'workspace') {
    return (
      <main className="narrow">
        <span className="mark">
          <Mark />
        </span>
        <p hidden data-testid="host-state">
          {state.state === 'verify' ? 'verify' : 'enroll'}
        </p>
        <h1>{state.state === 'verify' ? 'Enter your sign-in code' : 'Set up two-step sign-in'}</h1>
        <p className="lede">
          {state.state === 'verify'
            ? 'Enter the six-digit code from your authenticator app to continue.'
            : 'Set up an authenticator app. The host workspace stays locked until two-factor authentication is active.'}
        </p>
        <div className="panel">
          {factor ? (
            <form onSubmit={verify} className="stack" data-testid="host-verify-form">
              {factor.secret ? (
                <p>
                  Add this secret to your authenticator app: <code data-testid="host-secret">{factor.secret}</code>
                </p>
              ) : state.state === 'enroll' ? (
                <div className="stack" data-testid="host-enroll-interrupted">
                  <p>
                    Enrollment was not finished. Enter a current code if the secret was already saved, or restart to get
                    a new one.
                  </p>
                  <Button type="button" onClick={restart} disabled={busy} data-testid="host-enroll-start">
                    Restart enrollment
                  </Button>
                </div>
              ) : null}
              <Field label="Six-digit code">
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  data-testid="host-code"
                />
              </Field>
              <Button type="submit" variant="primary" disabled={busy} data-testid="host-verify-submit">
                Verify
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={startEnroll}
              disabled={busy}
              data-testid="host-enroll-start"
            >
              Set up authenticator
            </Button>
          )}
          <Toast testId="host-message">{message}</Toast>
        </div>
        <p className="actions" style={{ marginTop: 16 }}>
          <SignOutButton variant="ghost" />
        </p>
      </main>
    );
  }

  return (
    <>
      <HostBar />
      <main className="canvas">
        <p hidden data-testid="host-state">
          workspace
        </p>
        <div className="title-row">
          <div>
            <h1>Properties</h1>
            <p className="sub">
              {properties.length === 1 ? '1 property' : `${properties.length} properties`}. Each has its own guide,
              guest link and inbox.
            </p>
          </div>
        </div>
        <div className="layout">
          <div>
            <section className="panel" aria-labelledby="properties-heading">
              <header>
                <h2 id="properties-heading">Your properties</h2>
              </header>
              {properties.length === 0 ? (
                <p className="empty" data-testid="host-properties-empty">
                  No properties yet. Create the first one to start its guide.
                </p>
              ) : (
                <>
                  <ul className="rows" data-testid="host-properties">
                    {properties.map((property: PropertySummary) => (
                      <li key={property.id} className="property-row" data-testid="host-property">
                        <Link
                          to="/host/properties/$propertyId"
                          params={{ propertyId: property.id }}
                          data-testid="host-property-name"
                        >
                          {property.displayName}
                        </Link>
                        <Pill tone={property.published ? 'positive' : 'neutral'} testId="host-property-status">
                          {property.published ? 'Live' : 'Draft'}
                        </Pill>
                        <Button
                          type="button"
                          onClick={() => duplicate(property.id)}
                          disabled={busy}
                          data-testid="host-property-copy"
                        >
                          Make a copy
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Toast testId="host-copy-message">{copyMessage}</Toast>
                </>
              )}
            </section>
          </div>
          <div>
            <section className="panel" aria-labelledby="create-heading">
              <header>
                <h2 id="create-heading">New property</h2>
              </header>
              <form onSubmit={create} noValidate className="stack" data-testid="host-create-form">
                <Field
                  label="Property name"
                  error={createErrors.displayName}
                  errorId="create-name-error"
                  errorTestId="host-create-name-error"
                >
                  <input
                    name="displayName"
                    maxLength={120}
                    required
                    aria-invalid={Boolean(createErrors.displayName)}
                    aria-describedby={createErrors.displayName ? 'create-name-error' : undefined}
                    data-testid="host-create-name"
                  />
                </Field>
                <Field
                  label="Guide language"
                  error={createErrors.sourceLocale}
                  errorId="create-locale-error"
                  errorTestId="host-create-locale-error"
                >
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
                </Field>
                <div className="actions">
                  <Button type="submit" variant="primary" disabled={busy} data-testid="host-create-submit">
                    Create property
                  </Button>
                  <Toast testId="host-create-message">{createMessage}</Toast>
                </div>
              </form>
            </section>
            <section className="panel stack" aria-labelledby="account-heading">
              <h2 id="account-heading">Account</h2>
              <p className="muted">Need a hand with the first guide? The pilot team can set it up with you.</p>
              <div className="actions">
                <Button type="button" onClick={requestSupport} disabled={busy} data-testid="host-support-request">
                  Request setup support
                </Button>
                <Toast testId="host-support-message">{supportMessage}</Toast>
              </div>
              <div className="actions">
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => removeMfa(state.totpFactorIds[0] ?? '')}
                  disabled={busy || state.totpFactorIds.length === 0}
                  data-testid="host-remove-mfa"
                >
                  Remove authenticator
                </Button>
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
