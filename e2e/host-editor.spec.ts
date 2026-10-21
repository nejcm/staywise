import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { adminClient, detectLocalStack, totp } from '../src/tests/integration-helpers';

const local = detectLocalStack();
const email = `synthetic-e2e-${Date.now()}@example.test`;
let userId: string | undefined;

test.skip(!local, 'needs the local Supabase stack (bun run db:start)');
test.afterAll(async () => {
  if (!local) return;
  if (userId) expect((await adminClient(local).deleteUser(userId)).ok).toBe(true);
  const mail = await fetch(`${local.mailpitUrl}/api/v1/search?query=to:${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
  expect(mail.ok).toBe(true);
});

async function magicLink(mailpitUrl: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = (await (
      await fetch(`${mailpitUrl}/api/v1/search?query=to:${encodeURIComponent(email)}`)
    ).json()) as {
      messages: { ID: string }[];
    };
    const id = search.messages[0]?.ID;
    if (id) {
      const { Text } = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as { Text: string };
      const link = Text.match(/https?:\/\/\S+\/auth\/v1\/verify\S+/)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('magic link email not delivered');
}

test('signed-in host editor with an issued guest link has no axe violations and prints the QR card', async ({
  page,
  baseURL,
}) => {
  userId = await adminClient(local!).createUser(email);

  await page.goto('/auth/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByTestId('signin-form').getByRole('button').click();
  await expect(page.getByText('Check your email')).toBeVisible();

  // Auth only allowlists the :3000 callback; keep the PKCE code but land it on this server.
  const verify = await page.request.get(await magicLink(local!.mailpitUrl), { maxRedirects: 0 });
  const callback = new URL(verify.headers().location!);
  await page.goto(`${baseURL}${callback.pathname}${callback.search}`);
  await expect(page).toHaveURL(/\/host$/);

  await page.goto('/host/settings');
  await page.getByTestId('host-enroll-start').click();
  const secret = (await page.getByTestId('host-secret').textContent())!;
  await page.getByTestId('host-code').fill(totp(secret));
  await page.getByTestId('host-verify-submit').click();
  await expect(page.getByTestId('host-mfa-status')).toContainText('On.');

  await page.goto('/host');
  await page.getByTestId('host-create-name').fill('Synthetic Cabin');
  await page.getByTestId('host-create-submit').click();
  await expect(page).toHaveURL(/\/host\/properties\/[^/]+$/);
  await page.getByTestId('guest-link-create').click();
  await expect(page.getByTestId('guest-qr')).toBeVisible();

  for (const colorScheme of ['light', 'dark'] as const) {
    // Reduced motion: axe must not sample the issue button's 150ms restyle into "Make new link".
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations).toEqual([]);
  }

  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await expect(page.getByTestId('guest-link-panel').getByText('Synthetic Cabin')).toBeVisible();
  await expect(page.getByTestId('guest-link-copy')).toBeHidden();
  const card = page.getByTestId('guest-qr').locator('..');
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByTestId('guest-qr').locator('path').first()).toBeAttached();
  const urlColor = await card
    .locator('p')
    .last()
    .evaluate((url) => getComputedStyle(url).color);
  const [r, g, b] = (urlColor.match(/[\d.]+/g) ?? []).map((c) => Number(c) / 255);
  expect(0.2126 * r! + 0.7152 * g! + 0.0722 * b!).toBeLessThan(0.2);
  await card
    .locator('p')
    .last()
    .evaluate((url) => (url.style.color = 'transparent'));
  await expect(card).toHaveScreenshot('qr-print-card.png', {
    mask: [page.getByTestId('guest-qr')],
  });
});
