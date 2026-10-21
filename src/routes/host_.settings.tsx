import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { HostShell, SignOutButton } from '../components/app-shell';
import { Button } from '../components/button';
import { Field } from '../components/field';
import { useHostAction } from '../components/host-action';
import { Toast } from '../components/toast';
import { ThemePicker } from '../features/guide/theme-picker';
import { collectFieldErrors, guestLocales, hostSettingsInput } from '../features/guide/guide-validation';
import { languageNames } from '../features/guest/guest-ui';
import { deleteAccount, getHostAuthState, mfaUnenroll, restartEnrollment } from '../features/host/host-fns';
import { getHostSettings, saveHostSettings } from '../features/host/settings-fns';
import { createAgentToken, getAgentAccess, revokeAgentToken, revokeAllAgentTokens } from '../features/agent/agent-fns';
import { agentScopes, createGrantInput, grantLifetimes, scopeLabels } from '../features/agent/agent-validation';
import type { HostSettings } from '../features/host/settings.server';
import { TotpEnrollment } from '../features/host/totp-enrollment';
import styles from '../features/host/host.module.css';
import editorStyles from '../features/host/editor.module.css';

export const Route = createFileRoute('/host_/settings')({
  loader: async () => {
    const state = await getHostAuthState();
    if ('error' in state || state.state === 'signed_out') throw redirect({ to: '/auth/sign-in' });
    if (state.state !== 'workspace') throw redirect({ to: '/host' });
    const result = await getHostSettings();
    if ('error' in result) throw redirect({ to: '/host' });
    const agent = await getAgentAccess();
    if ('error' in agent) throw redirect({ to: '/host' });
    return {
      agent,
      totpFactorIds: state.totpFactorIds,
      email: result.email,
      settings: result.settings,
      saved: result.saved,
      timeZones: result.timeZones,
      accountDeletion: result.accountDeletion,
    };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { agent, totpFactorIds, email, settings, saved, timeZones, accountDeletion } = Route.useLoaderData();
  return (
    <HostShell email={email}>
      <div className={styles.head}>
        <div>
          <h1>Settings</h1>
          <p className={styles.sub}>Your account and the starting point for new properties.</p>
        </div>
      </div>
      <section className={`${styles.panel} stack`} aria-labelledby="defaults-heading">
        <h2 id="defaults-heading">Defaults for new properties</h2>
        <DefaultsForm settings={settings} saved={saved} timeZones={timeZones} />
      </section>
      <section className={`${styles.panel} stack`} aria-labelledby="mfa-heading">
        <h2 id="mfa-heading">Two-step sign-in</h2>
        <TwoStep factorIds={totpFactorIds} />
      </section>
      {agent.enabled ? (
        <section className={`${styles.panel} stack`} aria-labelledby="agent-heading" data-testid="agent-access">
          <h2 id="agent-heading">Agent access</h2>
          <AgentAccess grants={agent.grants} properties={agent.properties} endpoint={agent.endpoint} />
        </section>
      ) : null}
      <section className={`${styles.panel} stack`} aria-labelledby="session-heading">
        <h2 id="session-heading">Sign out</h2>
        <p className="muted">Ends the session in this browser.</p>
        <p className="actions">
          <SignOutButton />
        </p>
      </section>
      <section
        className={`${styles.panel} ${styles.danger} stack`}
        aria-labelledby="delete-account-heading"
        data-testid="account-delete-zone"
      >
        <h2 id="delete-account-heading">Delete account</h2>
        <DeleteAccount email={email} needsCode={totpFactorIds.length > 0} available={accountDeletion} />
      </section>
    </HostShell>
  );
}

const timeInputs = [
  { name: 'checkinTime', label: 'Check-in time', type: 'time' },
  { name: 'checkoutTime', label: 'Checkout time', type: 'time' },
  { name: 'contactPhone', label: 'Phone (international format, e.g. +38641234567)', type: 'tel', maxLength: 16 },
  { name: 'answerFrom', label: 'Usually answers from', type: 'time' },
  { name: 'answerTo', label: 'Usually answers until', type: 'time' },
] as const;

function DefaultsForm({
  settings: initial,
  saved,
  timeZones,
}: {
  settings: HostSettings;
  saved: boolean;
  timeZones: string[];
}) {
  const { busy, notice, setNotice, run } = useHostAction();
  const [sourceLocale, setSourceLocale] = useState<string>(initial.sourceLocale);
  const [enabledLocales, setEnabledLocales] = useState<readonly string[]>(initial.enabledLocales);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [suggested, setSuggested] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const zones = timeZones.includes(timezone) ? timeZones : [timezone, ...timeZones];

  // Suggestion only: nothing is stored until the host saves.
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (saved || browserZone === initial.timezone || !timeZones.includes(browserZone)) return;
    setTimezone(browserZone);
    setSuggested(true);
  }, [saved, initial.timezone, timeZones]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const parsed = hostSettingsInput.safeParse({
      theme: formData.get('theme'),
      sourceLocale: formData.get('sourceLocale'),
      enabledLocales: formData.getAll('enabledLocales').map(String),
      timezone: formData.get('timezone'),
      ...Object.fromEntries(timeInputs.map(({ name }) => [name, formData.get(name) ?? ''])),
    });
    if (!parsed.success) {
      setErrors(collectFieldErrors(parsed.error));
      setNotice({ text: 'Check the highlighted fields.', failed: true });
      return;
    }
    setErrors({});
    await run(
      () => saveHostSettings({ data: parsed.data }),
      () => {
        setSuggested(false);
        return 'Saved. New properties start with these values.';
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="stack" data-testid="settings-form">
      <p className="small muted">
        Copied into each property when you create it. Changing them later does not touch existing properties; copies
        keep the values of the property they come from.
      </p>
      <div className={editorStyles.fieldGrid}>
        <Field label="Guide language" error={errors.sourceLocale} errorId="settings-locale-error">
          <select
            name="sourceLocale"
            value={sourceLocale}
            onChange={(event) => setSourceLocale(event.target.value)}
            aria-invalid={Boolean(errors.sourceLocale)}
            aria-describedby={errors.sourceLocale ? 'settings-locale-error' : undefined}
            data-testid="settings-locale"
          >
            {guestLocales.map((code) => (
              <option key={code} value={code}>
                {languageNames[code]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Time zone" error={errors.timezone} errorId="settings-timezone-error">
          <select
            name="timezone"
            value={timezone}
            onChange={(event) => {
              setTimezone(event.target.value);
              setSuggested(false);
            }}
            aria-invalid={Boolean(errors.timezone)}
            aria-describedby={
              [suggested ? 'settings-timezone-hint' : '', errors.timezone ? 'settings-timezone-error' : '']
                .filter(Boolean)
                .join(' ') || undefined
            }
            data-testid="settings-timezone"
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {suggested ? (
        <p className="small muted" id="settings-timezone-hint" data-testid="settings-timezone-hint">
          Suggested from this browser. Save to use it.
        </p>
      ) : null}
      <fieldset data-testid="settings-locales">
        <legend>Guest languages</legend>
        {guestLocales
          .filter((code) => code !== sourceLocale)
          .map((code) => (
            <p key={code} style={{ marginTop: 8 }}>
              <label>
                <input
                  type="checkbox"
                  name="enabledLocales"
                  value={code}
                  checked={enabledLocales.includes(code)}
                  onChange={(event) =>
                    setEnabledLocales((current) =>
                      event.target.checked ? [...current, code] : current.filter((entry) => entry !== code),
                    )
                  }
                  data-testid={`settings-enabled-${code}`}
                />
                {languageNames[code]}
              </label>
            </p>
          ))}
        {errors.enabledLocales ? <p className="small">{errors.enabledLocales}</p> : null}
      </fieldset>
      <div className={editorStyles.fieldGrid}>
        {timeInputs.map((input) => {
          const errorId = `settings-${input.name}-error`;
          return (
            <Field
              key={input.name}
              label={input.label}
              error={errors[input.name]}
              errorId={errorId}
              errorTestId={errorId}
            >
              <input
                name={input.name}
                type={input.type}
                defaultValue={initial[input.name] ?? ''}
                maxLength={'maxLength' in input ? input.maxLength : undefined}
                autoComplete="off"
                aria-invalid={Boolean(errors[input.name])}
                aria-describedby={errors[input.name] ? errorId : undefined}
                data-testid={`settings-${input.name}`}
              />
            </Field>
          );
        })}
      </div>
      <ThemePicker defaultValue={initial.theme} />
      <div className="actions">
        <Button type="submit" variant="primary" disabled={busy} data-testid="settings-save">
          Save defaults
        </Button>
        <Toast testId="settings-save-status" tone={notice.failed ? 'error' : undefined}>
          {notice.text}
        </Toast>
      </div>
    </form>
  );
}

function TwoStep({ factorIds }: { factorIds: string[] }) {
  const router = useRouter();
  const { busy, notice, run } = useHostAction();
  if (!factorIds.length) {
    return (
      <>
        <p className="muted" data-testid="host-mfa-status">
          Off. Anyone who can open your email can sign in. An authenticator app adds a six-digit code.
        </p>
        <TotpEnrollment
          factorId={null}
          start={() => restartEnrollment({ data: {} })}
          onVerified={() => router.invalidate()}
        />
      </>
    );
  }
  return (
    <>
      <p className="muted" data-testid="host-mfa-status">
        On. Each sign-in asks for a code from your authenticator app.
      </p>
      <p className="actions">
        <Button
          type="button"
          variant="danger"
          onClick={() => run(() => mfaUnenroll({ data: { factorId: factorIds[0]! } }))}
          disabled={busy}
          data-testid="host-remove-mfa"
        >
          Remove authenticator
        </Button>
      </p>
      <Toast testId="host-message" tone={notice.failed ? 'error' : undefined}>
        {notice.text}
      </Toast>
    </>
  );
}

type AgentData = Extract<Awaited<ReturnType<typeof getAgentAccess>>, { enabled: true }>;

const utcDate = (iso: string) => iso.slice(0, 10);

function AgentAccess({ grants, properties, endpoint }: Omit<AgentData, 'enabled'>) {
  const { busy, notice, setNotice, run } = useHostAction();
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const parsed = createGrantInput.safeParse({
      name: formData.get('name'),
      scopes: formData.getAll('scopes').map(String),
      propertyId: formData.get('propertyId') || null,
      days: Number(formData.get('days')),
    });
    if (!parsed.success) {
      setErrors(collectFieldErrors(parsed.error));
      setNotice({ text: 'Check the highlighted fields.', failed: true });
      return;
    }
    setErrors({});
    setToken('');
    await run(
      () => createAgentToken({ data: parsed.data }),
      (result) => {
        setToken(result.token);
        form.reset();
        return 'Token created. Copy it now; it is shown only once.';
      },
    );
  }

  return (
    <>
      <p className="muted">
        Personal tokens let your own AI agent read your properties at <code>{endpoint}</code>. Agents never see guest
        messages, link secrets, Wi-Fi passwords or key-box codes.
      </p>
      <form onSubmit={submit} noValidate className="stack" data-testid="agent-token-form">
        <div className={editorStyles.fieldGrid}>
          <Field label="Token name" error={errors.name} errorId="agent-name-error">
            <input
              name="name"
              maxLength={100}
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'agent-name-error' : undefined}
              data-testid="agent-token-name"
            />
          </Field>
          <Field label="Property">
            <select name="propertyId" defaultValue="" data-testid="agent-token-property">
              <option value="">All properties</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expires after">
            <select name="days" defaultValue="30" data-testid="agent-token-days">
              {grantLifetimes.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset data-testid="agent-token-scopes">
          <legend>Permissions</legend>
          {agentScopes.map((scope) => (
            <p key={scope} style={{ marginTop: 8 }}>
              <label>
                <input
                  type="checkbox"
                  name="scopes"
                  value={scope}
                  defaultChecked={scope === 'read'}
                  data-testid={`agent-scope-${scope}`}
                />
                {scopeLabels[scope]}
              </label>
            </p>
          ))}
          {errors.scopes ? <p className="small">{errors.scopes}</p> : null}
        </fieldset>
        <div className="actions">
          <Button type="submit" variant="primary" disabled={busy} data-testid="agent-token-create">
            Create token
          </Button>
        </div>
      </form>
      {token ? (
        <Field label="New token (shown once)">
          <input readOnly value={token} onFocus={(event) => event.target.select()} data-testid="agent-token-value" />
        </Field>
      ) : null}
      {grants.length ? (
        <ul className={styles.rows} data-testid="agent-grants">
          {grants.map((grant) => (
            <li key={grant.id} data-testid="agent-grant">
              <p>
                <strong>{grant.name}</strong>
                {grant.kind === 'oauth' ? ` · connected app from ${grant.clientHost}` : ''}
              </p>
              <p className="small muted">
                {grant.scopes.join(', ')} · {grant.propertyName ?? 'All properties'} · expires{' '}
                {utcDate(grant.expiresAt)}
                {' · '}
                {grant.lastUsedAt ? `last used ${utcDate(grant.lastUsedAt)}` : 'never used'}
                {grant.clientLabel ? ` by ${grant.clientLabel}` : ''}
              </p>
              <p className="actions">
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => revokeAgentToken({ data: { grantId: grant.id } }),
                      () => 'Token revoked.',
                    )
                  }
                  data-testid="agent-grant-revoke"
                >
                  Revoke
                </Button>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted" data-testid="agent-grants-empty">
          No active tokens.
        </p>
      )}
      {grants.length ? (
        <p className="actions">
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={() =>
              run(
                () => revokeAllAgentTokens({ data: {} }),
                () => 'All tokens revoked.',
              )
            }
            data-testid="agent-grants-revoke-all"
          >
            Revoke all
          </Button>
        </p>
      ) : null}
      <Toast testId="agent-status" tone={notice.failed ? 'error' : undefined}>
        {notice.text}
      </Toast>
    </>
  );
}

const deleteFailures: Record<string, string> = {
  invalid_input: 'Type the email address of this account exactly.',
  invalid_code: 'That code did not work. Enter a new code from your authenticator app.',
};

function DeleteAccount({
  email,
  needsCode,
  available,
}: {
  email: string | null;
  needsCode: boolean;
  available: boolean;
}) {
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const matches = Boolean(email) && typed.trim().toLowerCase() === email?.toLowerCase();

  if (!available) {
    return <p className="muted">Account deletion is not available in this environment.</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await deleteAccount({ data: { email: typed, ...(needsCode ? { code } : {}) } });
      if ('error' in result) {
        setMessage(deleteFailures[result.error ?? ''] ?? 'Something went wrong. Try again.');
        return;
      }
      await navigate({ to: '/auth/sign-in', search: { status: 'deleted' } });
    } catch {
      setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack" data-testid="account-delete-form">
      <p className="small muted">
        Deletes your account and every property right away; this cannot be undone. Guest links stop working at once, and
        unread guest messages are deleted without export.
      </p>
      <Field label={`Type ${email ?? 'your account email'} to confirm`}>
        <input
          type="email"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          data-testid="account-delete-email"
        />
      </Field>
      {needsCode ? (
        <Field label="Six-digit code from your authenticator app">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            data-testid="account-delete-code"
          />
        </Field>
      ) : null}
      <div className="actions">
        <Button type="submit" variant="danger" disabled={busy || !matches} data-testid="account-delete">
          Delete account
        </Button>
        <Toast testId="account-delete-message" tone="error">
          {message}
        </Toast>
      </div>
    </form>
  );
}
