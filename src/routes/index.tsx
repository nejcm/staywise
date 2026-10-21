import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { buttonClass } from '../components/button';
import { Mark } from '../components/mark';
import { getHostAuthState } from '../features/host/host-fns';
import styles from '../features/host/public.module.css';

export const Route = createFileRoute('/')({
  loader: async () => {
    const state = await getHostAuthState();
    if (!('error' in state) && state.state !== 'signed_out') throw redirect({ to: '/host' });
  },
  component: HomePage,
});

function HomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Mark />
      </header>
      <main className={styles.split}>
        <section className={styles.hero}>
          <h1>Staywise</h1>
          <p>
            Hosts create and publish a guest guide, share it by link or QR code, and answer guest messages. Guests open
            the shared link to read the guide in English, German, Slovenian, French, or Spanish.
          </p>
        </section>
        <div className={styles.card}>
          <dl className={styles.facts}>
            <div>
              <dt>For hosts</dt>
              <dd>
                One guide per property, a guest link you can rotate, and one inbox for questions and issue reports.
              </dd>
            </div>
            <div>
              <dt>For guests</dt>
              <dd>No app and no account. Check-in, Wi-Fi and emergency details first, on any phone.</dd>
            </div>
          </dl>
          <p className="actions">
            <Link to="/auth/sign-in" className={buttonClass('primary')}>
              Host sign in
            </Link>
            <Link to="/privacy" className={buttonClass()}>
              Privacy and data handling
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
