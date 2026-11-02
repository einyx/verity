import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import svgr from 'vite-plugin-svgr';

const owned = new Map<string, { instance: ViteDevServer; origin: string }>();
const origin = (key = 'current') => owned.get(key)?.origin ?? '';
const luminance = (color: string) => {
  const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
};
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    console.error(error.message);
  });
});
const startServer = async (before = false) => {
  const instance = await createServer({
    configFile: false,
    define: { 'process.env': {} },
    root: process.cwd(),
    resolve: { alias: { '@': path.resolve('src') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'synthetic-console-shell-dependencies',
        enforce: 'pre',
        load(id) {
          const file = path.relative(process.cwd(), id.replace(/\?.*$/, ''));
          if (
            before &&
            [
              'src/containers/ConsoleContent/index.module.scss',
              'src/containers/ConsoleContent/Sidebar/index.module.scss',
            ].includes(file)
          ) {
            return execFileSync(
              'git',
              ['show', `d4fd8be2cef2c6c6a981d22f5a1cc01b275ceb77:packages/console/${file}`],
              { encoding: 'utf8' }
            );
          }
          if (file === 'src/hooks/use-admin-console-tour.ts') {
            return 'export default () => {};';
          }
          if (file === 'src/hooks/use-theme.ts') {
            return 'export default () => new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";';
          }
          if (file === 'src/hooks/use-tenant-pathname.ts') {
            return 'export default () => ({getTo: path => "/synthetic" + path});';
          }
          if (file === 'src/consts/env.ts') {
            return 'export const isCloud = true;';
          }
          if (file === 'src/components/Topbar/AiChat/index.tsx') {
            return 'export default () => <button type="button">Assistant</button>;';
          }
          if (file === 'src/components/Topbar/TenantSelector/index.tsx') {
            return 'import styles from "./index.module.scss"; export default ({isCollapsed}) => <div role="button" tabIndex={0} aria-label="Current tenant" className={[styles.currentTenantCard,styles.compact,isCollapsed && styles.collapsed].filter(Boolean).join(" ")}><span className={styles.avatar}>Ad</span><div className={styles.name}>Admin</div><span>Prod</span><span>⌄</span></div>;';
          }
          if (file === 'src/containers/ConsoleContent/Sidebar/OssCloudCard.tsx') {
            return 'export default () => null;';
          }
          if (file === 'src/containers/ConsoleContent/Sidebar/use-shell-navigation.ts') {
            return 'import {createElement} from "react"; const Icon = () => createElement("span",null,"◻"); const section = {title:"overview",label:"Overview",items:[{title:"dashboard",label:"Dashboard",Icon,path:"dashboard"}]}; export default () => ({sections:[section],active:{section,item:section.items[0]}});';
          }
        },
        configureServer(vite) {
          vite.middlewares.use((request, _response, next) => {
            if (request.url?.startsWith('/console/meshx-logo')) {
              // eslint-disable-next-line @silverhand/fp/no-mutation -- mirror the production public base in this owned Connect request
              request.url = request.url.replace('/console/', '/');
            }
            next();
          });
          vite.middlewares.use('/__console_shell', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              await vite.transformIndexHtml(
                '/__console_shell',
                '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="app"></div><script type="module" src="/tests/browser/fixtures/console-shell.tsx"></script></body></html>'
              )
            );
          });
        },
      },
      react(),
      svgr(),
    ],
  });
  await instance.listen();
  const address = instance.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture address');
  }
  return { instance, origin: `http://127.0.0.1:${address.port}` };
};
test.beforeAll(async () => {
  owned.set('current', await startServer());
  owned.set('baseline', await startServer(true));
});
test.afterAll(async () => {
  await Promise.all([...owned.values()].map(async ({ instance }) => instance.close()));
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: baseline shell at matching desktop and mobile viewports`, async ({
    browser,
  }, info) => {
    await Promise.all(
      [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ].map(async (viewport) => {
        const context = await browser.newContext({ viewport, screen: viewport });
        const page = await context.newPage();
        await page.goto(`${origin('baseline')}/__console_shell?theme=${theme}`);
        await expect(page.getByRole('complementary')).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`shell-${theme}-before-${viewport.width}.png`),
        });
        await context.close();
      })
    );
  });
  test(`${theme}: desktop shell, keyboard collapse, saved width and pointer limits`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin()}/__console_shell?theme=${theme}`);
    const rail = page.getByRole('complementary', { name: 'Console navigation' });
    const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toHaveAttribute('aria-controls', 'console-sidebar');
    await expect(rail).toHaveCSS('width', '264px');
    await expect(rail.locator('..')).toHaveCSS('border-radius', '24px');
    await expect(page.locator('main').locator('..')).toHaveCSS('border-radius', '16px');
    await expect(rail.locator('..')).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('main').locator('..')).toHaveCSS(
      'border-top-color',
      'rgba(0, 0, 0, 0)'
    );
    const switcher = page.getByRole('button', { name: 'Current tenant' });
    await expect(switcher).toHaveCSS('border-top-width', '0px');
    await expect(switcher.locator('..')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(switcher.locator('..')).toHaveCSS('border-top-width', '1px');
    await switcher.focus();
    await expect(switcher).toHaveCSS('outline-style', 'solid');
    await expect(switcher).toHaveCSS('outline-width', '2px');
    await rail.screenshot({ path: info.outputPath(`rail-${theme}-focus.png`) });
    await switcher.blur();
    const colors = await rail.evaluate((element) => {
      const secondary = element.querySelector('input');
      return {
        foreground: secondary
          ? (element.ownerDocument.defaultView?.getComputedStyle(secondary, '::placeholder')
              .color ?? '')
          : '',
        background:
          element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor ?? '',
      };
    });
    const levels = [luminance(colors.foreground), luminance(colors.background)];
    expect((Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05)).toBeGreaterThanOrEqual(4.5);
    const logo = rail.getByAltText('meshX');
    await expect(logo).toHaveJSProperty('complete', true);
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(`shell-${theme}-desktop.png`) });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(rail).toHaveCSS('width', '60px');
    await page.reload();
    await expect(rail).toHaveCSS('width', '60px');
    await page.getByRole('button', { name: 'Expand sidebar' }).press('Space');
    const separator = page.getByRole('separator');
    await separator.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '296');
    await page.reload();
    await expect(separator).toHaveAttribute('aria-valuenow', '296');
    const box = await separator.boundingBox();
    if (!box) {
      throw new Error('Missing resize handle');
    }
    await page.mouse.move(box.x + 3, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(1000, box.y + 100);
    await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', '480');
    await separator.press('ArrowLeft');
    const second = await separator.boundingBox();
    if (!second) {
      throw new Error('Missing resize handle');
    }
    await page.mouse.move(second.x + 3, second.y + 100);
    await page.mouse.down();
    await page.mouse.move(0, second.y + 100);
    await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', '200');
    expect(
      await page
        .locator('html')
        .evaluate(
          (element) => element.scrollWidth <= (element.ownerDocument.defaultView?.innerWidth ?? 0)
        )
    ).toBe(true);
  });

  test(`${theme}: mobile overlay has one control and restores focus`, async ({ browser }, info) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(`${origin()}/__console_shell?theme=${theme}`);
    const rail = page.getByRole('complementary');
    await expect(rail).toHaveCSS('width', '60px');
    const open = page.getByRole('button', { name: 'Expand sidebar' });
    await expect(open).toHaveCount(1);
    await open.press('Enter');
    const close = page.getByRole('button', { name: 'Collapse sidebar' });
    await expect(close).toHaveCount(1);
    await expect(close).toBeFocused();
    await expect(rail).toHaveCSS('position', 'fixed');
    await expect(rail).toHaveCSS('width', '264px');
    await page.screenshot({ path: info.outputPath(`shell-${theme}-mobile-expanded.png`) });
    await close.press('Space');
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeFocused();
    await expect(rail).toHaveCSS('width', '60px');
    expect(
      await page
        .locator('html')
        .evaluate(
          (element) => element.scrollWidth <= (element.ownerDocument.defaultView?.innerWidth ?? 0)
        )
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`shell-${theme}-mobile.png`) });
    await context.close();
  });
}
