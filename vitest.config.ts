import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // A developer's .env must never make the suite send errors to PostHog.
    env: { VITE_POSTHOG_PROJECT_TOKEN: '', VITE_POSTHOG_HOST: '' },
    include: ['src/**/*.test.{ts,tsx}'],
    // One file at a time: the security suite rotates the shared app_runtime password, which would
    // fail new pool connections that other local suites open while that window is open.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 33, statements: 32, functions: 37, branches: 33 },
      exclude: ['src/**/*.test.{ts,tsx}', 'src/tests/**', 'src/routeTree.gen.ts', 'src/vite-env.d.ts'],
    },
  },
});
