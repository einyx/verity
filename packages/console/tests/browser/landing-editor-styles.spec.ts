import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { preprocessCSS, resolveConfig } from 'vite';

const loadStyles = async () => {
  const config = await resolveConfig(
    {
      configFile: false,
      resolve: { alias: { '@': path.resolve('src') } },
      css: { modules: { generateScopedName: '[local]' } },
    },
    'serve'
  );
  const files = [
    'src/contexts/AppThemeProvider/index.module.scss',
    'src/cloud/pages/LandingPageEditor/index.module.scss',
  ];
  const results = await Promise.all(
    files.map(async (file) => {
      const result = await preprocessCSS(await readFile(file, 'utf8'), path.resolve(file), config);
      return result.code;
    })
  );
  return results.join('\n');
};

const css = loadStyles();

const testTheme = (theme: string) => {
  test(`keeps small status and publish text readable in ${theme} appearance`, async ({ page }) => {
    await page.setContent(`<div class="${theme}"><div class="shell topbarLayout">
      <span class="liveBadge">Live: version 1</span>
      <button class="primaryButton">Publish to website</button>
    </div></div>`);
    await page.addStyleTag({ content: await css });

    const contrast = async (selector: string) =>
      page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        // eslint-disable-next-line unicorn/consistent-function-scoping -- This callback runs in the browser, so module-level helpers are unavailable.
        const luminance = (color: string) => {
          const [red = 0, green = 0, blue = 0] = (color.match(/[\d.]+/g) ?? [])
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return red * 0.2126 + green * 0.7152 + blue * 0.0722;
        };
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      });

    expect(await contrast('.liveBadge')).toBeGreaterThanOrEqual(4.5);
    expect(await contrast('.primaryButton')).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button').hover();
    expect(await contrast('.primaryButton')).toBeGreaterThanOrEqual(4.5);
  });

  test(`uses the ${theme} console surfaces for editor panels, not the website`, async ({
    page,
  }) => {
    await page.setContent(`<div class="${theme}">
      <div class="editorWorkspace">
        <aside class="editorSections"><div class="editorPaneHeading"><button>Add section</button></div></aside>
        <section class="liveCanvas"><div class="liveCanvasToolbar"><button>Undo</button></div></section>
        <aside class="editorInspector"><div class="elementProperties"><label class="elementField"><input /></label></div></aside>
      </div>
      <div id="reference" style="background:var(--color-layer-1);color:var(--color-text)">Reference</div>
    </div>`);
    await page.addStyleTag({ content: await css });
    const expected = await page.locator('#reference').evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      text: getComputedStyle(element).color,
    }));
    await Promise.all(
      [
        '.editorWorkspace',
        '.liveCanvasToolbar',
        '.elementProperties',
        '.editorPaneHeading button',
        '.elementField input',
      ].map(async (selector) => {
        await expect(page.locator(selector)).toHaveCSS('background-color', expected.background);
        await expect(page.locator(selector)).toHaveCSS('color', expected.text);
      })
    );
  });
};

for (const theme of ['light', 'dark']) {
  testTheme(theme);
}

test('scales the entire simulated viewport without clipping its right edge or leaving phantom height', async ({
  page,
}) => {
  await page.setContent(`<div class="liveCanvasBody" style="width:928px;box-sizing:border-box">
    <div class="fittedPreview"><span class="previewZoom">Fit · 70%</span>
      <div class="fittedPreviewViewport" style="width:896px;--preview-scale:0.7">
        <iframe class="pageFrame" title="Preview" style="width:1280px" srcdoc="<body style='margin:0;background:white'>Website</body>"></iframe>
      </div>
    </div>
  </div>`);
  await page.addStyleTag({ content: await css });
  const viewport = await page.locator('.fittedPreviewViewport').boundingBox();
  const frame = await page.getByTitle('Preview').boundingBox();
  if (!viewport || !frame) {
    throw new Error('The preview and its viewport must be visible');
  }
  expect(frame.width).toBeCloseTo(896, 0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
  expect(frame.height).toBeCloseTo(viewport.height, 0);
  const logicalHeight = Math.max((page.viewportSize()?.height ?? 0) * 0.68, 480);
  const logicalViewport = await page
    .getByTitle('Preview')
    .evaluate((element: HTMLIFrameElement) => ({
      width: element.contentWindow?.innerWidth,
      height: element.contentWindow?.innerHeight,
    }));
  expect(logicalViewport.width).toBe(1280);
  expect(logicalViewport.height).toBeCloseTo(logicalHeight, 0);

  await page.locator('.fittedPreviewViewport').evaluate((element: HTMLElement) => {
    element.setAttribute('style', '--preview-scale: 0.5; width: 640px');
  });
  const resizedViewport = await page
    .getByTitle('Preview')
    .evaluate((element: HTMLIFrameElement) => ({
      width: element.contentWindow?.innerWidth,
      height: element.contentWindow?.innerHeight,
    }));
  expect(resizedViewport).toEqual(logicalViewport);
  const resizedFrame = await page.getByTitle('Preview').boundingBox();
  expect(resizedFrame?.width).toBeCloseTo(640, 0);
  expect(resizedFrame?.height).toBeCloseTo(logicalHeight * 0.5, 0);
});
