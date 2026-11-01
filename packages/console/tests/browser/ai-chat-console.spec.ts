import path from 'node:path';

import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import svgr from 'vite-plugin-svgr';

// Real AiChat / Conversation / Thread / theme CSS, with only environment, auth/API and setup
// boundaries replaced. This server serves synthetic local test data; it cannot reach a provider.
const harness: { server?: ViteDevServer; origin: string } = { origin: '' };

test.beforeAll(async () => {
  const server = await createServer({
    configFile: false,
    define: { 'process.env': {} },
    root: process.cwd(),
    cacheDir: '.cache/node_modules/ai-chat-browser',
    resolve: { alias: { '@': path.resolve('src') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'synthetic-chat-boundaries',
        enforce: 'pre',
        resolveId(id, importer) {
          const sourceId = id.replace(`${path.resolve('src')}/`, '@/');
          if (
            [
              '@/hooks/use-api',
              '@/hooks/use-theme',
              '@/consts/env',
              '@/cloud/hooks/use-landing-page',
            ].includes(sourceId)
          ) {
            return `\0synthetic:${sourceId}`;
          }
          if (
            importer?.includes('/Topbar/AiChat/') &&
            ['./SetupBanner', './use-landing-page-ai-headers'].includes(id)
          ) {
            return `\0synthetic:${id}`;
          }
        },
        load(id) {
          if (!id.startsWith('\0synthetic:')) {
            return;
          }
          if (id.endsWith('use-api')) {
            return `import ky from 'ky'; const api = ky.create({prefixUrl: location.origin, timeout: 20000}); export default () => api;`;
          }
          if (id.endsWith('use-theme')) {
            return `export default () => new URLSearchParams(location.search).get('theme') || 'light';`;
          }
          if (id.endsWith('consts/env')) {
            return `export const isDevFeaturesEnabled = new URLSearchParams(location.search).get('variant') === 'workspace';`;
          }
          if (id.endsWith('use-landing-page')) {
            return `export const landingPageEditorKey = 'synthetic-editor';`;
          }
          if (id.endsWith('SetupBanner')) {
            return 'export default () => null;';
          }
          return 'export default () => async () => ({});';
        },
        configureServer(vite) {
          vite.middlewares.use('/__ai-chat-test', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              await vite.transformIndexHtml(
                '/__ai-chat-test',
                '<html><body style="margin:0"><div id="app"></div><script type="module" src="/tests/browser/fixtures/ai-chat.tsx"></script></body></html>'
              )
            );
          });
        },
      },
      react(),
      svgr(),
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('No isolated test port');
  }
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Test lifecycle owns this local server.
  harness.server = server;
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Port is assigned by the OS before tests run.
  harness.origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await harness.server?.close();
});

const luminance = (color: string) => {
  const channels = (color.match(/[\d.]+/g) ?? [])
    .slice(0, 3)
    .map(Number)
    .map((value) => value / 255)
    .map((value) => (value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
};

// eslint-disable-next-line unicorn/no-array-for-each -- Register independently scoped parameterized tests.
['workspace', 'legacy'].forEach((variant) => {
  // eslint-disable-next-line unicorn/no-array-for-each -- Each registration closes over its own theme.
  ['light', 'dark'].forEach((theme) => {
    test(`${variant} ${theme}: synthetic reply renders and user bubble contrast is AA`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      await page.emulateMedia({ reducedMotion: 'reduce' });
      page.on('pageerror', (error) => {
        // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Collect browser failures for an assertion.
        errors.push(error.message);
      });
      const requests: string[] = [];
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== harness.origin) {
          return route.abort();
        }
        if (url.pathname === '/api/ai-chat/completions') {
          // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Record intercepted requests, never replay them.
          requests.push(url.pathname);
          return route.fulfill({
            json: { content: 'Synthetic review: the hero copy is readable.' },
          });
        }
        if (
          url.pathname.startsWith('/api/') ||
          !['GET', 'HEAD'].includes(route.request().method())
        ) {
          throw new Error(
            `Unexpected network operation: ${route.request().method()} ${url.pathname}`
          );
        }
        return route.continue();
      });
      await page.goto(`${harness.origin}/__ai-chat-test?variant=${variant}&theme=${theme}`);
      await page
        .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
        .click();
      await page
        .getByRole('textbox')
        .fill('Review this synthetic hero, without editing or publishing.');
      await page
        .getByRole('button', { name: 'admin_console.inkeep_ai_bot.send', exact: true })
        .click();
      await expect(page.getByText('Synthetic review: the hero copy is readable.')).toBeVisible();
      expect(requests).toEqual(['/api/ai-chat/completions']);
      const bubble = page.locator('.demo-chat-message[data-role="user"]');
      const computed = await bubble.evaluate((element) => {
        const style = getComputedStyle(element);
        return { foreground: style.color, background: style.backgroundColor };
      });
      const foreground = luminance(computed.foreground);
      const background = luminance(computed.background);
      const colors = {
        ...computed,
        ratio:
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      };
      await testInfo.attach('computed-contrast', {
        body: JSON.stringify(colors),
        contentType: 'application/json',
      });
      await page.screenshot({
        path: testInfo.outputPath(`${variant}-${theme}.png`),
        fullPage: true,
      });
      expect(colors.ratio).toBeGreaterThanOrEqual(4.5);
      expect(errors).toEqual([]);
    });
  });
});
