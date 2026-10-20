import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = [
  { path: '/', heading: 'Staywise' },
  { path: '/privacy', heading: /privacy/i },
  { path: '/auth/sign-in', heading: /sign in/i },
];

for (const { path, heading } of pages) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${path} renders and has no axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations).toEqual([]);
    });
  }
}

test('unknown route serves the styled not-found page', async ({ page }) => {
  const response = await page.goto('/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('security headers are present', async ({ request }) => {
  const response = await request.get('/privacy');
  expect(response.headers()['content-security-policy']).toBeTruthy();
});
