import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../components/button';
import { Field } from '../components/field';
import { Mark } from '../components/mark';
import { Toast } from '../components/toast';
import { approveConsent, getConsent } from '../features/agent/oauth-fns';
import { agentScopes, scopeLabels } from '../features/agent/agent-validation';
import styles from '../features/host/public.module.css';

export const Route = createFileRoute('/oauth/authorize')({
  // The raw query, not the router's JSON-parsed search, so every OAuth value stays the exact string sent.
  loader: async ({ location }) => {
    const params = Object.fromEntries(new URLSearchParams(location.searchStr));
    const consent = await getConsent({ data: params });
    if ('error' in consent) {
      return {
        params,
        consent: { state: 'error' as const, message: 'Something went wrong. Start again from your app.' },
      };
    }
    if (consent.state === 'redirect') throw redirect({ href: consent.url });
    return { params, consent };
  },
  component: AuthorizePage,
});

type Ready = Extract<Awaited<ReturnType<typeof getConsent>>, { state: 'ok' }>;

function AuthorizePage() {
  const { params, consent } = Route.useLoaderData();
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Mark />
      </header>
      <main className={styles.split}>
        <section className={`${styles.card} ${styles.solo}`} aria-labelledby="consent-heading" data-testid="consent">
          {consent.state === 'ok' ? (
            <ConsentForm consent={consent} params={params} />
          ) : (
            <>
              <h1 id="consent-heading">Connect an app</h1>
              {consent.state === 'error' ? (
                <p className={styles.lede} data-testid="consent-error">
                  {consent.message}
                </p>
              ) : (
                <>
                  <p className={styles.lede} data-testid="consent-sign-in">
                    {consent.state === 'sign_in'
                      ? 'Sign in to Staywise in this browser, then come back to this tab and reload it.'
                      : 'Confirm your two-step code in Staywise, then come back to this tab and reload it.'}
                  </p>
                  <p className="actions">
                    <Link to={consent.state === 'sign_in' ? '/auth/sign-in' : '/host'} target="_blank">
                      Open Staywise
                    </Link>
                    <Button type="button" onClick={() => window.location.reload()}>
                      Reload
                    </Button>
                  </p>
                </>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function ConsentForm({ consent, params }: { consent: Ready; params: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const scopes = formData.getAll('scopes').map(String) as (typeof agentScopes)[number][];
    if (!scopes.length) {
      setMessage('Choose at least one permission.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await approveConsent({
        data: { params, scopes, propertyId: String(formData.get('propertyId') ?? '') || null },
      });
      if ('error' in result) throw new Error(result.error);
      window.location.assign(result.url);
    } catch {
      setMessage('Could not connect the app. Reload this page and try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <h1 id="consent-heading">Connect {consent.clientName}?</h1>
        <p className={styles.lede}>
          Requested by {consent.clientHost}. It will act for you at <code>{consent.resource}</code>, and you return to{' '}
          <strong data-testid="consent-redirect-host">{consent.redirectHost}</strong>.
        </p>
      </div>
      {consent.loopback ? (
        <p className="small" role="note" data-testid="consent-loopback">
          This app returns to a program on your own computer. Approve only if you started this connection yourself just
          now.
        </p>
      ) : null}
      <form onSubmit={approve} noValidate className={styles.cardForm} data-testid="consent-form">
        <fieldset>
          <legend>Permissions</legend>
          {agentScopes.map((scope) => (
            <p key={scope} style={{ marginTop: 8 }}>
              <label>
                <input
                  type="checkbox"
                  name="scopes"
                  value={scope}
                  defaultChecked={consent.requestedScopes.includes(scope)}
                  data-testid={`consent-scope-${scope}`}
                />
                {scopeLabels[scope]}
              </label>
            </p>
          ))}
        </fieldset>
        <Field label="Property">
          <select name="propertyId" defaultValue="" data-testid="consent-property">
            <option value="">All properties</option>
            {consent.properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="small muted">
          Agents never see guest messages, link secrets, Wi-Fi passwords or key-box codes. Access ends after 90 days,
          and you can revoke it any time in Settings.
        </p>
        <p className="actions">
          <Button type="submit" variant="primary" disabled={busy} data-testid="consent-approve">
            Approve
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => window.location.assign(consent.denyUrl)}
            data-testid="consent-deny"
          >
            Deny
          </Button>
        </p>
        <Toast testId="consent-message" tone="error">
          {message}
        </Toast>
      </form>
    </>
  );
}
