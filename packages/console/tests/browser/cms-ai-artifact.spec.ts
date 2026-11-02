/* eslint-disable @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods -- Test-owned Vite lifecycle, route rewriting and bounded browser evidence arrays. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';

const owned: { server?: ViteDevServer; origin?: string } = {};
const waitForFonts = async () => window.document.fonts.ready;
test.beforeAll(async () => {
  owned.server = await createServer({
    configFile: false,
    define: { 'process.env': {} },
    root: process.cwd(),
    resolve: { alias: { '@': path.resolve('src') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      react(),
      {
        name: 'owned-cms-artifact-fixture',
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url?.startsWith('/console/landing-preview')) {
              response.setHeader('Content-Type', 'text/html');
              response.end(await readFile('public/landing/index.html', 'utf8'));
              return;
            }
            if (request.url?.startsWith('/console/landing/')) {
              request.url = request.url.replace('/console/landing/', '/landing/');
            }
            if (request.url?.split('?')[0] === '/artifact') {
              response.setHeader('Content-Type', 'text/html');
              response.end(
                await server.transformIndexHtml(
                  '/artifact',
                  '<div id="root"></div><script type="module" src="/tests/browser/fixtures/cms-artifact.tsx"></script>'
                )
              );
              return;
            }
            next();
          });
        },
      },
    ],
  });
  await owned.server.listen();
  owned.origin = owned.server.resolvedUrls?.local[0]?.replace(/\/$/, '');
});
test.afterAll(async () => {
  await owned.server?.close();
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1024]) {
    test(`save controls keep their geometry while saving: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/')) {
          throw new Error('Owned saving fixture must not call an API');
        }
        await (url.origin === owned.origin
          ? route.continue()
          : route.fulfill({ status: 204, body: '' }));
      });
      await page.goto(`${owned.origin}/artifact?mockSave=1`);
      await page.evaluate(waitForFonts);
      const save = page.getByRole('button', { name: 'Save draft', exact: true });
      await expect(save).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(250, 249, 247)' : 'rgb(27, 25, 25)'
      );
      const node = await save.elementHandle();
      const before = await save.boundingBox();
      const discardBefore = await page.getByRole('button', { name: 'Discard' }).boundingBox();
      await save.click();
      const saving = page.getByRole('button', { name: 'Saving draft…', exact: true });
      await expect(saving).toBeDisabled();
      await expect(saving).toHaveAttribute('aria-busy', 'true');
      expect(await saving.evaluate((element, original) => element === original, node)).toBe(true);
      expect(await saving.boundingBox()).toEqual(before);
      expect(await page.getByRole('button', { name: 'Discard' }).boundingBox()).toEqual(
        discardBefore
      );
      await expect(page.getByRole('button', { name: 'Discard' })).toBeDisabled();
      expect(before?.height).toBeGreaterThanOrEqual(24);
    });
  }
}

test('production proposal renders the real branded CMS hero with nonce handshake and no page writes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push(`${route.request().method()} ${url.pathname}`);
      await route.abort();
    } else if (url.origin === owned.origin) {
      await route.continue();
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
  await page.goto(`${owned.origin}/artifact`);
  const preview = page.frameLocator('iframe[title="Proposed landing page preview"]');
  await expect(preview.locator('#top')).toContainText('Govern financial data with confidence');
  await expect(preview.locator('#top')).toContainText('A synthetic bank-call introduction');
  await expect(preview.locator('#top [contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  await page.getByRole('button', { name: 'Expand preview' }).click();
  await expect(page.locator('iframe').locator('..')).toHaveAttribute('data-expanded', 'true');
  await page.locator('iframe').evaluate((frame) => {
    if (!(frame instanceof HTMLIFrameElement)) {
      throw new TypeError('Missing CMS frame');
    }
    frame.contentWindow?.postMessage(
      {
        type: 'meshx-cms-draft',
        nonce: 'wrong-preview',
        doc: { sections: [{ id: 'hero', type: 'hero', headline: ['Wrong frame content'] }] },
      },
      location.origin
    );
  });
  await expect(preview.locator('#top')).not.toContainText('Wrong frame content');
  await expect(page.getByRole('status')).toHaveText('Not saved');
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('cms-ai-artifact.png'), fullPage: true });
});
/* eslint-enable @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods */
