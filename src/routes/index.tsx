import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <main>
      <h1>Staywise</h1>
      <p>Guest guide portal — application foundation. No guest or host features are live yet.</p>
    </main>
  );
}
