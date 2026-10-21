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
import {
  collectFieldErrors,
  guestLocales,
  propertyFields,
  sectionCategories,
  sectionCategoryLabels,
  type SectionCategory,
} from '../features/guide/guide-validation';
import styles from '../features/host/host.module.css';
import publicStyles from '../features/host/public.module.css';
import { guestLocaleName } from '../features/guest/guest-ui';

type Workspace = Extract<Awaited<ReturnType<typeof listOwnProperties>>, { properties: unknown }>;
type PropertySummary = Workspace['properties'][number];

export const Route = createFileRoute('/host')({
  validateSearch: (search: Record<string, unknown>): { setup?: true } => (search.setup === true ? { setup: true } : {}),
  loaderDeps: ({ search }) => ({ setup: search.setup === true }),
  loader: async ({ deps }) => {
    const state = await getHostAuthState({ data: { setup: deps.setup } });
    if ('error' in state || state.state === 'signed_out') {
      throw redirect({ to: '/auth/sign-in' });
    }
    if (state.state !== 'workspace') {
      return { state, workspace: null };
    }
    const list = await listOwnProperties();
    if ('error' in list && list.error === 'auth_required') {
      throw redirect({ to: '/auth/sign-in' });
    }
    return { state, workspace: 'error' in list ? null : list };
  },
  component: HostPage,
});

function HostPage() {
  const { state, workspace } = Route.useLoaderData();
  const properties = workspace?.properties ?? [];
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
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await mfaUnenroll({ data: { factorId } });
      if ('error' in result) {
        setMessage('Something went wrong. Try again.');
        setMessageFailed(true);
        return;
      }
      await router.invalidate();
    } catch {
      setMessage('Something went wrong. Try again.');
      setMessageFailed(true);
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
    <HostShell email={workspace?.email}>
      <p hidden data-testid="host-state">
        workspace
      </p>
      <div className={styles.head}>
        <div>
          <h1>Properties</h1>
          <p className={styles.sub}>{workspaceSummary(properties)}</p>
        </div>
        <a href="#create-heading" className={buttonClass('primary')} data-testid="host-add-property">
          <PlusIcon />
          Add property
        </a>
      </div>
      {!workspace ? (
        <div role="alert" className={styles.loadError} data-testid="host-properties-error">
          <strong>Couldn't load your properties</strong>
          <p>Your guides are fine and guests can still open them. It's a problem on our side or with the connection.</p>
          <Button type="button" onClick={() => void router.invalidate()}>
            Try again
          </Button>
        </div>
      ) : properties.length === 0 ? (
        <section className={styles.onboarding} aria-labelledby="onboarding-heading" data-testid="host-properties-empty">
          <div className={styles.onboardingHead}>
            <h2 id="onboarding-heading">Let's set up your first guide</h2>
            <p>Three steps. Stop any time and come back.</p>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>1</span>
              <div>
                <strong>Name the property</strong>
                <p className="muted">And the language you write the guide in.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Wi-Fi, check-in and contact</strong>
                <p className="muted">The rest of the guide can wait.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Publish and share</strong>
                <p className="muted">Send the link or print the QR card.</p>
              </div>
            </li>
          </ol>
          <a href="#create-heading" className={buttonClass('primary')}>
            <PlusIcon />
            Add your first property
          </a>
        </section>
      ) : (
        <>
          <section className={styles.panel} aria-labelledby="properties-heading">
            <header className={`${styles.panelHead} ${styles.tableHead}`}>
              <h2 id="properties-heading">{properties.length === 1 ? '1 home' : `${properties.length} homes`}</h2>
              <ul aria-label="Language key" className={styles.legend}>
                {(Object.keys(languageStateLabels) as LanguageState[]).map((key) => (
                  <li key={key}>
                    <span className={`${styles.lang} ${styles[key]}`} />
                    {languageStateLabels[key]}
                  </li>
                ))}
              </ul>
            </header>
            <div className={styles.tableScroll}>
              <table className={styles.table} data-testid="host-properties">
                <thead>
                  <tr>
                    <th scope="col">Home</th>
                    <th scope="col">Guide</th>
                    <th scope="col">Languages</th>
                    <th scope="col">Guest link</th>
                    <th scope="col" className={styles.num}>
                      Waiting
                    </th>
                    <th scope="col" className={styles.num}>
                      <span className={styles.srOnly}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map((property) => (
                    <PropertyRow key={property.id} property={property} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <WaitingAndSetup properties={properties} waiting={workspace.waiting} />
        </>
      )}
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
              <select
                name="sourceLocale"
                defaultValue="en"
                aria-invalid={Boolean(createErrors.sourceLocale)}
                aria-describedby={createErrors.sourceLocale ? 'create-locale-error' : undefined}
                data-testid="host-create-locale"
              >
                {guestLocales.map((locale) => (
                  <option key={locale} value={locale}>
                    {guestLocaleName(locale)}
                  </option>
                ))}
              </select>
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
          {properties.length ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void duplicate(String(new FormData(event.currentTarget).get('source')));
              }}
              className={`stack ${styles.copyForm}`}
            >
              <Field label="Or start from a copy of">
                <select name="source" data-testid="host-copy-source">
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.displayName}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="actions">
                <Button type="submit" disabled={busy} data-testid="host-property-copy">
                  Make a copy
                </Button>
                <Toast testId="host-copy-message" tone={copyMessageFailed ? 'error' : undefined}>
                  {copyMessage}
                </Toast>
              </div>
            </form>
          ) : null}
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
                <Toast testId="host-message" tone={messageFailed ? 'error' : undefined}>
                  {message}
                </Toast>
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

type LanguageState = 'original' | 'reviewed' | 'review' | 'off';

const languageStateLabels: Record<LanguageState, string> = {
  original: 'Original',
  reviewed: 'Reviewed',
  review: 'Needs review',
  off: 'Not offered',
};

function languageState(property: PropertySummary, locale: string): LanguageState {
  if (locale === property.sourceLocale) return 'original';
  if (!property.enabledLocales.includes(locale)) return 'off';
  return property.reviewedLocales.includes(locale) ? 'reviewed' : 'review';
}

const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const dayMs = 24 * 60 * 60_000;

function dayLabel(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${monthFormat.format(date)}`;
}

function utcDay(time: number): number {
  return Math.floor(time / dayMs);
}

function editedLabel(iso: string): string {
  return utcDay(Date.parse(iso)) === utcDay(Date.now()) ? 'today' : dayLabel(iso);
}

function ageLabel(iso: string): string {
  const time = Date.parse(iso);
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  const days = utcDay(Date.now()) - utcDay(time);
  if (minutes < 60) return `${minutes} min`;
  if (days === 0) return `${Math.round(minutes / 60)} h`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return weekdayFormat.format(new Date(time));
  return dayLabel(iso);
}

function missingCategories(property: PropertySummary): SectionCategory[] {
  return sectionCategories.filter((category) => !property.categories.includes(category));
}

function workspaceSummary(properties: PropertySummary[]): string {
  const waitingAt = properties.filter((property) => property.waiting > 0);
  const waiting = waitingAt.reduce((total, property) => total + property.waiting, 0);
  const linksOff = properties.filter((property) => property.published && !property.linkOn);
  const parts: string[] = [];
  if (waiting) {
    const where = waitingAt.length === 1 ? ` at ${waitingAt[0]!.displayName}` : '';
    parts.push(
      `${waiting === 1 ? '1 guest' : `${waiting} guests`}${where} ${waiting === 1 ? 'is' : 'are'} waiting for a reply`,
    );
  }
  if (linksOff.length === 1) parts.push(`${linksOff[0]!.displayName}'s link is off`);
  else if (linksOff.length) parts.push(`${linksOff.length} guest links are off`);
  return parts.length ? parts.join(' · ') : 'Each property has its own guide, guest link and inbox.';
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PropertyRow({ property }: { property: PropertySummary }) {
  const params = { propertyId: property.id };
  const filled = sectionCategories.length - missingCategories(property).length;
  return (
    <tr data-testid="host-property">
      <td>
        <Link
          to="/host/properties/$propertyId"
          params={params}
          className={styles.homeName}
          data-testid="host-property-name"
        >
          {property.displayName}
        </Link>
        <span className={styles.homeMeta}>
          {property.address ? `${property.address} · ` : ''}edited {editedLabel(property.editedAt)}
        </span>
      </td>
      <td>
        <span className={styles.pills}>
          <Pill tone={property.published ? 'positive' : 'neutral'} testId="host-property-status">
            {property.published ? 'Published' : 'Draft'}
          </Pill>
          {property.published && property.unpublishedSections ? (
            <Pill tone="attention">
              {property.unpublishedSections === 1
                ? '1 unpublished section'
                : `${property.unpublishedSections} unpublished sections`}
            </Pill>
          ) : null}
          {property.published ? null : (
            <Pill>
              {filled} of {sectionCategories.length} sections
            </Pill>
          )}
        </span>
      </td>
      <td>
        <span className={styles.langs}>
          {guestLocales.map((locale) => {
            const state = languageState(property, locale);
            return (
              <span
                key={locale}
                className={`${styles.lang} ${styles[state]}`}
                aria-label={`${guestLocaleName(locale)}, ${languageStateLabels[state].toLowerCase()}`}
                role="img"
              >
                {locale.toUpperCase()}
              </span>
            );
          })}
        </span>
      </td>
      <td data-label="Guest link">
        {!property.published ? (
          <span className={styles.none}>—</span>
        ) : property.linkOn ? (
          'On'
        ) : (
          <Pill tone="negative">Off</Pill>
        )}
      </td>
      <td className={styles.num} data-label="Waiting">
        {!property.published && !property.waiting ? (
          <span className={styles.none}>—</span>
        ) : property.waiting ? (
          <Link to="/host/properties/$propertyId" params={params} hash="inbox-heading" className={styles.waiting}>
            {property.waiting}
          </Link>
        ) : (
          <span className={styles.none}>0</span>
        )}
      </td>
      <td className={`${styles.num} ${styles.rowActions}`}>
        {property.published && property.linkOn ? (
          <Link
            to="/host/properties/$propertyId"
            params={params}
            hash="guest-link-heading"
            className={buttonClass('ghost')}
          >
            Share
          </Link>
        ) : null}
        {property.published && !property.linkOn ? null : (
          <Link to="/host/preview/$propertyId" params={params} className={buttonClass('ghost')}>
            Preview
          </Link>
        )}
        {property.published && !property.linkOn ? (
          <Link to="/host/properties/$propertyId" params={params} hash="guest-link-heading" className={buttonClass()}>
            Turn link on
          </Link>
        ) : (
          <Link to="/host/properties/$propertyId" params={params} className={buttonClass()}>
            {property.published ? 'Edit' : 'Continue setup'}
          </Link>
        )}
      </td>
    </tr>
  );
}

function WaitingAndSetup({ properties, waiting }: { properties: PropertySummary[]; waiting: Workspace['waiting'] }) {
  const setup = properties.find((property) => !property.published);
  const missing = setup ? missingCategories(setup) : [];
  if (!waiting.length && !setup) return null;
  return (
    <div className={styles.columns}>
      {waiting.length ? (
        <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="waiting-heading">
          <header className={styles.panelHead}>
            <h2 id="waiting-heading">Waiting for a reply</h2>
          </header>
          <ul className={styles.rows} data-testid="host-waiting">
            {waiting.map((message) => (
              <li key={message.id}>
                <Link
                  to="/host/properties/$propertyId"
                  params={{ propertyId: message.propertyId }}
                  hash="inbox-heading"
                  className={styles.waitingRow}
                >
                  <Pill tone={message.kind === 'issue' ? 'attention' : 'accent'}>
                    {message.kind === 'issue' ? 'Issue' : 'Question'}
                  </Pill>
                  <span className={styles.excerpt}>
                    <strong>{message.propertyName}</strong> · <span lang={message.locale}>{message.excerpt}</span>
                  </span>
                  <span className={styles.age}>{ageLabel(message.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {setup ? (
        <section className={styles.setup} aria-labelledby="setup-heading">
          <h2 id="setup-heading">
            {setup.displayName}: {sectionCategories.length - missing.length} of {sectionCategories.length} sections
          </h2>
          <div
            role="img"
            aria-label={`${sectionCategories.length - missing.length} of ${sectionCategories.length} sections written`}
            className={styles.progress}
          >
            {sectionCategories.map((category) => (
              <span key={category} data-filled={!missing.includes(category) || undefined} />
            ))}
          </div>
          {missing.length ? (
            <p>
              {missing.map((category) => sectionCategoryLabels[category]).join(', ')}{' '}
              {missing.length === 1 ? 'is' : 'are'} still empty.
            </p>
          ) : (
            <p>Every section has content. Publish when it reads right.</p>
          )}
          <Link to="/host/properties/$propertyId" params={{ propertyId: setup.id }}>
            Continue setup
          </Link>
        </section>
      ) : null}
    </div>
  );
}
