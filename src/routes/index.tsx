import { Link, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <main>
      <h1>Staywise</h1>
      <p>
        Hosts create and publish a guest guide, share it by link or QR code, and answer guest messages. Guests open the
        shared link to read the guide in English, German, or Slovenian.
      </p>
      <p>
        <Link to="/auth/sign-in">Host sign in</Link>
      </p>
      <p>
        <Link to="/privacy">Privacy and data handling</Link>
      </p>
    </main>
  );
}
