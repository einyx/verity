import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Route } from '@playwright/test';

/* eslint-disable no-await-in-loop, @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods -- Viewports and UI actions must be captured sequentially because they share one browser page. */

const landingRoot = path.resolve('public/landing');
const fixturesRoot = path.resolve('../../experiments/malecns-demo-agent/fixtures');
const landingBase = 'http://localhost/console/landing/';
const viewportSet = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'tablet', width: 900, height: 900 },
  { name: 'tablet_portrait', width: 768, height: 1024 },
  { name: 'narrow', width: 390, height: 844 },
  { name: 'phone_tall', width: 430, height: 932 },
  { name: 'phone_landscape', width: 844, height: 390 },
];
const actions = {
  landing: 'open_demo',
  demo_chat: 'choose_demo',
  contact_details: 'provide_test_details',
  consent: 'wait_for_human',
  complete: 'stop',
} as const;

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const routePage = async (route: Route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/landing-page') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ published: { demoChat: { enabled: true } } }),
    });
  }
  if (url.pathname === '/api/landing-page/chat/config') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ turnstileSiteKey: null }),
    });
  }
  if (url.pathname.startsWith('/console/landing/')) {
    const relative = url.pathname.slice('/console/landing/'.length) || 'index.html';
    const file = path.join(landingRoot, relative);
    if (!file.startsWith(landingRoot)) {
      return route.abort();
    }
    try {
      const body = await readFile(file);
      await route.fulfill({
        status: 200,
        contentType: contentTypes[path.extname(file)] ?? 'application/octet-stream',
        body,
      });
    } catch {
      return route.fulfill({ status: 404, body: 'not found' });
    }
  }
  return route.abort();
};

test('capture labeled screenshots from the rendered demo-request flow', async ({ page }) => {
  const dataset: Array<{ screenshot: string; action: string; group: string }> = [];
  await mkdir(fixturesRoot, { recursive: true });

  for (const viewport of viewportSet) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    let turn = 0;
    await page.route('**/*', routePage);
    await page.route('**/api/landing-page/chat', async (route) => {
      turn += 1;
      const response =
        turn === 1
          ? { reply: 'Please share your name, work email, and company for a demo.' }
          : turn === 2
            ? { reply: 'May we contact you about your demo?', options: ['Yes', 'No'] }
            : { reply: 'Mock request received.', submitted: true };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    });

    const capture = async (state: keyof typeof actions) => {
      const screenshot = `${state}.${viewport.name}.png`;
      await page.screenshot({ path: path.join(fixturesRoot, screenshot) });
      dataset.push({ screenshot, action: actions[state], group: viewport.name });
    };

    await page.goto(`${landingBase}index.html`);
    await capture('landing');
    await page.locator('a[href="#demo-chat"]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('demo_chat');

    await page.getByRole('button', { name: 'Platform demo' }).click();
    await expect(page.getByText(/share your name/i)).toBeVisible();
    await capture('contact_details');

    await page.getByLabel('Your message').fill('Alex Demo, demo@example.test, Example Inc.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('button', { name: 'Yes' })).toBeVisible();
    await capture('consent');

    // A synthetic visitor explicitly consents in this mocked browser fixture. The model never clicks Yes.
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(page.getByText('Mock request received.')).toBeVisible();
    await capture('complete');
    await page.unroute('**/*', routePage);
    await page.unroute('**/api/landing-page/chat');
  }

  await writeFile(path.join(fixturesRoot, 'dataset.json'), `${JSON.stringify(dataset, null, 2)}\n`);
});
/* eslint-enable no-await-in-loop, @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods */
