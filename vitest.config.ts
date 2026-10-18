import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // One file at a time: the security suite rotates the shared app_runtime password, which would
    // fail new pool connections that other local suites open while that window is open.
    fileParallelism: false,
  },
});
