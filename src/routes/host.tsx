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
import { HostShell, SignOutButton } from '../components/app-shell';
import { Button, buttonClass } from '../components/button';
import { Field } from '../components/field';
import { Mark } from '../components/mark';
import { Pill } from '../components/pill';
import { Toast } from '../components/toast';
import { copyProperty, createProperty, requestSetupSupport } from '../features/guide/guide-fns';
import { collectFieldErrors, propertyFields } from '../features/guide/guide-validation';
import styles from '../features/host/host.module.css';
import publicStyles from '../features/host/public.module.css';

type PropertySummary = { id: string; displayName: string; published: boolean; createdAt: Date };

export const Route = createFileRoute('/host')({
  validateSearch: (search: Record<string, unknown>): { setup?: true } => (search.setup === true ? { setup: true } : {}),
  loaderDeps: ({ search }) => ({ setup: search.setup === true }),
  loader: async ({ deps }) => {
    const state = await getHostAuthState({ data: { setup: deps.setup } });
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
  const [messageFailed, setMessageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [createMessage, setCreateMessage] = useState('');
  const [createMessageFailed, setCreateMessageFailed] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [copyMessageFailed, setCopyMessageFailed] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [supportMessageFailed, setSupportMessageFailed] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = propertyFields.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      setCreateErrors(collectFieldErrors(parsed.error));
      setCreateMessage('Check the highlighted fields.');
      setCreateMessageFailed(true);
      return;
    }
    setCreateErrors({});
    setCreateMessage('');
    setCreateMessageFailed(false);
    setBusy(true);
    try {
      const result = await createProperty({ data: parsed.data });
      if ('error' in result) {
        setCreateMessage('Something went wrong. Try again.');
        setCreateMessageFailed(true);
        return;
      }
      await navigate({ to: '/host/properties/$propertyId', params: { propertyId: result.propertyId } });
    } catch {
      setCreateMessage('Something went wrong. Try again.');
      setCreateMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(sourcePropertyId: string) {
    setCopyMessage('');
    setCopyMessageFailed(false);
    setBusy(true);
    try {
      const result = await copyProperty({ data: { sourcePropertyId } });
      if ('error' in result) {
        setCopyMessage('Something went wrong. Try again.');
        setCopyMessageFailed(true);
        return;
      }
      await navigate({ to: '/host/properties/$propertyId', params: { propertyId: result.propertyId } });
    } catch {
      setCopyMessage('Something went wrong. Try again.');
      setCopyMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function requestSupport() {
    setSupportMessage('');
    setSupportMessageFailed(false);
    setBusy(true);
    try {
      const result = await requestSetupSupport({ data: {} });
      setSupportMessage(
        'error' in result ? 'Something went wrong. Try again.' : 'Request recorded for the pilot team.',
      );
      setSupportMessageFailed('error' in result);
    } catch {
      setSupportMessage('Something went wrong. Try again.');
      setSupportMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function startEnroll() {
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await mfaEnroll({ data: {} });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        setMessageFailed(true);
        return;
      }
      setFactor({ factorId: result.factorId, secret: result.secret });
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await restartEnrollment({ data: {} });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        setMessageFailed(true);
        return;
      }
      setFactor({ factorId: result.factorId, secret: result.secret });
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factor) return;
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await mfaVerify({ data: { factorId: factor.factorId, code } });
      if ('error' in result) {
        setMessage(
          result.error === 'invalid_code' ? 'That code did not match. Try again.' : 'Something went wrong. Try again.',
        );
        setMessageFailed(true);
        return;
      }
      setCode('');
      setFactor(null);
      await navigate({ to: '/host', search: {} });
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
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
      <div className={publicStyles.page}>
        <header className={publicStyles.top}>
          <Mark />
        </header>
        <main className={publicStyles.split}>
          <div className={`${publicStyles.card} ${publicStyles.solo}`}>
            <p hidden data-testid="host-state">
              {state.state === 'verify' ? 'verify' : 'enroll'}
            </p>
            <h1>{state.state === 'verify' ? 'Enter your sign-in code' : 'Set up two-step sign-in'}</h1>
            <p className={publicStyles.lede}>
              {state.state === 'verify'
                ? 'Enter the six-digit code from your authenticator app to continue.'
                : state.optional
                  ? 'Add an authenticator app. After this, every sign-in asks for a six-digit code as well as the email link.'
                  : 'Set up an authenticator app. The host workspace stays locked until two-factor authentication is active.'}
            </p>
            <div>
              {factor ? (
                <form onSubmit={verify} className="stack" data-testid="host-verify-form">
                  {factor.secret ? (
                    <p>
                      Add this secret to your authenticator app: <code data-testid="host-secret">{factor.secret}</code>
                    </p>
                  ) : state.state === 'enroll' ? (
                    <div className="stack" data-testid="host-enroll-interrupted">
                      <p>
                        Enrollment was not finished. Enter a current code if the secret was already saved, or restart to
                        get a new one.
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
              <Toast testId="host-message" tone={messageFailed ? 'error' : undefined}>
                {message}
              </Toast>
            </div>
            <p className="actions">
              {state.state === 'enroll' && state.optional ? (
                <Link to="/host" search={{}} className={buttonClass('ghost')} data-testid="host-enroll-skip">
                  Not now
                </Link>
              ) : null}
              <SignOutButton variant="ghost" />
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <HostShell>
      <p hidden data-testid="host-state">
        workspace
      </p>
      <div className={styles.head}>
        <div>
          <h1>Properties</h1>
          <p className={styles.sub}>
            {properties.length === 1 ? '1 property' : `${properties.length} properties`}. Each has its own guide, guest
            link and inbox.
          </p>
        </div>
      </div>
      <section className={styles.panel} aria-labelledby="properties-heading">
        <header className={styles.panelHead}>
          <h2 id="properties-heading">Your properties</h2>
        </header>
        {properties.length === 0 ? (
          <p className={styles.empty} data-testid="host-properties-empty">
            No properties yet. Create the first one to start its guide.
          </p>
        ) : (
          <>
            <ul className={styles.rows} data-testid="host-properties">
              {properties.map((property: PropertySummary) => (
                <li key={property.id} className={styles.propertyRow} data-testid="host-property">
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
            <Toast testId="host-copy-message" tone={copyMessageFailed ? 'error' : undefined}>
              {copyMessage}
            </Toast>
          </>
        )}
      </section>
      <div className={styles.columns}>
        <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="create-heading">
          <header className={styles.panelHead}>
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
              <Toast testId="host-create-message" tone={createMessageFailed ? 'error' : undefined}>
                {createMessage}
              </Toast>
            </div>
          </form>
        </section>
        <section className={`${styles.panel} ${styles.side} stack`} aria-labelledby="account-heading">
          <h2 id="account-heading">Account</h2>
          <p className="muted">Need a hand with the first guide? The pilot team can set it up with you.</p>
          <div className="actions">
            <Button type="button" onClick={requestSupport} disabled={busy} data-testid="host-support-request">
              Request setup support
            </Button>
            <Toast testId="host-support-message" tone={supportMessageFailed ? 'error' : undefined}>
              {supportMessage}
            </Toast>
          </div>
          <div className="stack">
            <h3>Two-step sign-in</h3>
            {state.totpFactorIds.length ? (
              <>
                <p className="muted" data-testid="host-mfa-status">
                  On. Each sign-in asks for a code from your authenticator app.
                </p>
                <p className="actions">
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => removeMfa(state.totpFactorIds[0]!)}
                    disabled={busy}
                    data-testid="host-remove-mfa"
                  >
                    Remove authenticator
                  </Button>
                </p>
              </>
            ) : (
              <>
                <p className="muted" data-testid="host-mfa-status">
                  Off. Anyone who can open your email can sign in. An authenticator app adds a six-digit code.
                </p>
                <p className="actions">
                  <Link
                    to="/host"
                    search={{ setup: true }}
                    reloadDocument
                    className={buttonClass()}
                    data-testid="host-add-mfa"
                  >
                    Set up authenticator
                  </Link>
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </HostShell>
  );
}
