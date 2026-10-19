import { Link, createFileRoute } from '@tanstack/react-router';
import { Mark } from '../components/mark';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="narrow">
      <span className="mark">
        <Mark name="" />
      </span>
      <h1>Staywise</h1>
      <p className="lede">
        Hosts create and publish a guest guide, share it by link or QR code, and answer guest messages. Guests open the
        shared link to read the guide in English, German, or Slovenian.
      </p>
      <dl className="panel facts">
        <div>
          <dt>For hosts</dt>
          <dd>One guide per property, a guest link you can rotate, and one inbox for questions and issue reports.</dd>
        </div>
        <div>
          <dt>For guests</dt>
          <dd>No app and no account. Check-in, Wi-Fi and emergency details first, on any phone.</dd>
        </div>
      </dl>
      <p className="actions" style={{ marginTop: 32 }}>
        <Link to="/auth/sign-in" className="button primary">
          Host sign in
        </Link>
        <Link to="/privacy" className="button">
          Privacy and data handling
        </Link>
      </p>
    </main>
  );
}
