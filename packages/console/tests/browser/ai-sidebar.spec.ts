import path from 'node:path';

import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import svgr from 'vite-plugin-svgr';

const owned = new Map<string, { server: ViteDevServer; origin: string }>();
const origin = () => owned.get('fixture')?.origin ?? '';
test.beforeAll(async () => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { '@': path.resolve('src') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      react(),
      svgr(),
      {
        name: 'synthetic-sidebar',
        configureServer(vite) {
          vite.middlewares.use('/__sidebar', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              await vite.transformIndexHtml(
                '/__sidebar',
                '<html><body style="margin:0"><div id="app"></div><script type="module" src="/tests/browser/fixtures/ai-sidebar.tsx"></script></body></html>'
              )
            );
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture port');
  }
  owned.set('fixture', { server, origin: `http://127.0.0.1:${address.port}` });
});
test.afterAll(async () => {
  await owned.get('fixture')?.server.close();
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: compact synthetic titles, keyboard selection, filters and bounded scrolling`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(`${origin()}/__sidebar?theme=${theme}`);
    const current = page.locator('button[aria-current="true"]');
    await expect(current).toBeVisible();
    const title = current.locator('span');
    expect(
      await title.evaluate((element) => element.getBoundingClientRect().height)
    ).toBeLessThanOrEqual(40);
    expect(
      await title.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).webkitLineClamp
      )
    ).toBe('2');
    const titleBox = await title.boundingBox();
    const dateBox = await current.locator('time').boundingBox();
    expect(dateBox?.y).toBeGreaterThanOrEqual((titleBox?.y ?? 0) + (titleBox?.height ?? 0));
    const list = page.getByRole('list', { name: 'Conversations' });
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true
    );
    const second = list.getByRole('button').nth(1);
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Archived', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(second).toHaveAttribute('aria-current', 'true');
    await page.screenshot({ path: testInfo.outputPath(`sidebar-${theme}.png`) });
    await list.focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('button', { name: 'Workspaces', exact: true })).toBeVisible();
  });
}

test('narrow history opens with keyboard and retains readable RTL rows', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${origin()}/__sidebar?rtl`);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('button[aria-current="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeFocused();
});

test('empty and loading states keep the existing filters available', async ({ page }) => {
  await page.goto(`${origin()}/__sidebar?empty`);
  await expect(page.getByText('No conversations yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recent', exact: true })).toBeVisible();
  await page.goto(`${origin()}/__sidebar?empty&loading`);
  await expect(page.getByRole('status')).toHaveText('Loading conversations…');
  await expect(page.getByText('No conversations yet')).toHaveCount(0);
});
