import { defineConfig, devices } from '@playwright/test';

const port = 3100;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bun run build && APP_ENV=local APP_ORIGIN=http://localhost:${port} bunx vite preview --port ${port}`,
    url: `http://localhost:${port}/privacy`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
