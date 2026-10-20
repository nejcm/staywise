import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../components/button';
import { Field } from '../components/field';
import { Mark } from '../components/mark';
import { Toast } from '../components/toast';
import { getHostAuthState, requestMagicLink } from '../features/host/host-fns';
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

function SignInPage() {
  const { status } = Route.useSearch();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(status === 'restart' ? RESTART_MESSAGE : '');
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
          <h1>Host sign in</h1>
          <p>Host accounts are invite-only. Enter your invited email address to get a one-time sign-in link.</p>
        </section>
        <form onSubmit={onSubmit} className={styles.card} data-testid="signin-form">
          <Field label="Email">
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
      </main>
      <footer className={styles.foot}>
        <Link to="/privacy">Privacy and data handling</Link>
      </footer>
    </div>
  );
}
