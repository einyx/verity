import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import svgr from 'vite-plugin-svgr';

const owned = new Map<string, { server: ViteDevServer; origin: string }>();
const baselineLoads = new Set<string>();
const luminance = (color: string) => {
  const [red = 0, green = 0, blue = 0] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
};
const origin = () => owned.get('fixture')?.origin ?? '';
const startServer = async (before = false) => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { '@': path.resolve('src') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'sidebar-baseline-source',
        enforce: 'pre',
        load(id) {
          const relative = path.relative(process.cwd(), id.replace(/\?.*$/, ''));
          if (
            before &&
            ['AiWorkspace.tsx', 'SessionSidebar.tsx', 'workspace.module.scss'].some(
              (file) => relative === `src/components/Topbar/AiChat/${file}`
            )
          ) {
            baselineLoads.add(path.basename(relative));
            return execFileSync(
              'git',
              ['show', `0658f5764884bb6dab4fadbf02dd37e210598abf:packages/console/${relative}`],
              { encoding: 'utf8' }
            );
          }
        },
      },
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
  return { server, origin: `http://127.0.0.1:${address.port}` };
};
test.beforeAll(async () => {
  owned.set('fixture', await startServer());
  owned.set('baseline', await startServer(true));
});
test.afterAll(async () => {
  await Promise.all([...owned.values()].map(async ({ server }) => server.close()));
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
    await Promise.all(
      [title, current.locator('time'), page.getByText('Explore your console')].map(async (text) => {
        const colors = await text.evaluate((element) => {
          const view = element.ownerDocument.defaultView;
          if (!view) {
            throw new Error('Missing fixture window');
          }
          const surface = (node: Element | undefined): string => {
            if (!node) {
              throw new Error('Missing opaque text surface');
            }
            const background = view.getComputedStyle(node).backgroundColor;
            return background === 'rgba(0, 0, 0, 0)'
              ? surface(node.parentElement ?? undefined)
              : background;
          };
          return { foreground: view.getComputedStyle(element).color, background: surface(element) };
        });
        const foreground = luminance(colors.foreground);
        const background = luminance(colors.background);
        expect(
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        ).toBeGreaterThanOrEqual(4.5);
      })
    );
    const list = page.getByRole('list', { name: 'Conversations' });
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true
    );
    const second = list.getByRole('button').nth(1);
    await second.focus();
    await expect(second).toBeFocused();
    expect(
      await second.evaluate((element) => element.getBoundingClientRect().height)
    ).toBeGreaterThanOrEqual(24);
    expect(
      await second.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).outlineStyle
      )
    ).toBe('solid');
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
    await expect.poll(async () => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Workspaces', exact: true })).toBeInViewport();
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

test('short desktop rail retains independently scrollable history and reachable Explore links', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(`${origin()}/__sidebar`);
  const rail = page.getByRole('complementary', { name: 'Ask AI history' });
  const list = page.getByRole('list', { name: 'Conversations' });
  await list.focus();
  const railScroll = await rail.evaluate((element) => element.scrollTop);
  await page.keyboard.press('End');
  await expect.poll(async () => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await rail.evaluate((element) => element.scrollTop)).toBe(railScroll);
  const landing = page.getByRole('button', { name: 'Landing page', exact: true });
  await landing.scrollIntoViewIfNeeded();
  await expect(landing).toBeInViewport();
  await landing.focus();
  await expect(landing).toBeFocused();
  expect(await list.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(88);
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: Recent/Archived and conversation tab strips are pixel-identical to baseline`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const before = await context.newPage();
    const after = await context.newPage();
    try {
      await before.goto(`${owned.get('baseline')?.origin}/__sidebar?theme=${theme}`);
      await after.goto(`${origin()}/__sidebar?theme=${theme}`);
      await Promise.all(
        [before, after].map(async (page) => {
          await page.getByRole('tablist', { name: 'Open conversations' }).waitFor();
          await page.locator('html').evaluate(async (element) => element.ownerDocument.fonts.ready);
        })
      );
      expect([...baselineLoads].slice().sort()).toEqual([
        'AiWorkspace.tsx',
        'SessionSidebar.tsx',
        'workspace.module.scss',
      ]);
      await Promise.all(
        ['filters', 'tabs'].map(async (strip) => {
          const baseline =
            strip === 'filters'
              ? before.getByRole('button', { name: 'Recent', exact: true }).locator('..')
              : before.getByRole('tablist', { name: 'Open conversations' });
          const candidate =
            strip === 'filters'
              ? after.getByRole('button', { name: 'Recent', exact: true }).locator('..')
              : after.getByRole('tablist', { name: 'Open conversations' });
          expect(await candidate.boundingBox()).toEqual(await baseline.boundingBox());
          const baselinePixels = await baseline.screenshot({
            path: testInfo.outputPath(`${theme}-${strip}-before.png`),
          });
          const candidatePixels = await candidate.screenshot({
            path: testInfo.outputPath(`${theme}-${strip}-after.png`),
          });
          expect(
            candidatePixels.equals(baselinePixels),
            `${theme} ${strip} exact PNG comparison`
          ).toBe(true);
        })
      );
    } finally {
      await context.close();
    }
  });
}
