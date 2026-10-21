import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../components/button';
import { Field } from '../components/field';
import { Mark } from '../components/mark';
import { Toast } from '../components/toast';
import { getHostAuthState, requestMagicLink } from '../features/host/host-fns';
import { languageNames } from '../features/guest/guest-ui';
import styles from '../features/host/public.module.css';

export const Route = createFileRoute('/auth/sign-in')({
  validateSearch: (search: Record<string, unknown>): { status?: string } => ({
    status: typeof search.status === 'string' ? search.status : undefined,
  }),
  // Stale or revoked session cookies are cleared on the sign-in document itself, because SSR
  // redirects from /host cannot carry Set-Cookie headers.
  loader: async () => {
    await getHostAuthState();
  },
  component: SignInPage,
});

const RESTART_MESSAGE =
  'The sign-in link could not be completed in this browser. Request a new link and open it in the same browser.';

const statusMessages: Record<string, string> = { restart: RESTART_MESSAGE, deleted: 'Your account was deleted.' };

function SignInPage() {
  const { status } = Route.useSearch();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(statusMessages[status ?? ''] ?? '');
  const [messageFailed, setMessageFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setMessageFailed(false);
    try {
      const result = await requestMagicLink({ data: { email } });
      setMessage(
        'error' in result
          ? 'Something went wrong. Request a new link and try again.'
          : 'Check your email for the sign-in link. Open it in this same browser.',
      );
      setMessageFailed('error' in result);
    } catch {
      setMessage('Something went wrong. Request a new link and try again.');
      setMessageFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link to="/">
          <Mark />
        </Link>
      </header>
      <main className={styles.split}>
        <section className={styles.hero}>
          <h1>A calm guest guide for your rental</h1>
          <p>Write it once, share one link or QR code, and answer guest questions from one inbox.</p>
          <ul className={styles.heroChips}>
            <li>No app or account for guests</li>
            <li>{Object.values(languageNames).join(' · ')}</li>
          </ul>
        </section>
        <section className={styles.card} aria-labelledby="signin-heading">
          <div>
            <h2 id="signin-heading">Sign in</h2>
            <p className={styles.lede}>We&apos;ll email you a link. No password to remember.</p>
          </div>
          <form onSubmit={onSubmit} className={styles.cardForm} data-testid="signin-form">
            <Field label="Email address">
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                data-testid="signin-email"
              />
            </Field>
            <Button type="submit" variant="primary" disabled={busy} data-testid="signin-submit">
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </Button>
            <Toast testId="signin-message" tone={messageFailed ? 'error' : undefined}>
              {message}
            </Toast>
          </form>
          <p className="small muted">
            Host accounts are invite-only: use the address you were invited with. See the{' '}
            <Link to="/privacy">privacy notice</Link>.
          </p>
        </section>
      </main>
      <footer className={styles.foot}>
        <Link to="/privacy">Privacy and data handling</Link>
      </footer>
    </div>
  );
}
