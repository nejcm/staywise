import { createFileRoute } from '@tanstack/react-router';

// PKCE callback: the only GET route allowed to exchange the one-use code for a session.
export const Route = createFileRoute('/auth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { completeAuthCallback } = await import('../features/auth/auth.server');
        return completeAuthCallback(request);
      },
    },
  },
});
