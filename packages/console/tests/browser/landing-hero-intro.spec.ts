import { readFile } from 'node:fs/promises';

import { defaultLandingPageContent } from '@logto/schemas';
import { expect, test } from '@playwright/test';

test('Hero Intro edits appear in the real preview and published renderer without saving content', async ({
  page,
  context,
}, info) => {
  const source = await readFile('public/landing/index.html', 'utf8');
  const html =
    source.replaceAll(/<script\b[^>]*>[\S\s]*?<\/script\b[^>]*>/gi, '') +
    '<script src="/console/landing/landing-renderer.js"></script><script src="/console/landing/landing-elements.js"></script><script src="/console/landing/cms.js"></script>';
  const document = {
    ...defaultLandingPageContent,
    sections: defaultLandingPageContent.sections.map((section) =>
      section.type === 'hero' ? { ...section, lede: 'XXXXXXXX' } : section
    ),
  };
  const host = `<!doctype html><label>Intro text<input id="intro" value="Previous introduction"></label><iframe id="preview" src="/preview?cmsPreview=1" style="width:1280px;height:900px"></iframe><script>
    const draft = ${JSON.stringify(defaultLandingPageContent)};
    const frame = document.getElementById('preview');
    const echo = () => frame.contentWindow.postMessage({type:'meshx-cms-draft',doc:draft}, location.origin);
    frame.addEventListener('load', echo);
    document.getElementById('intro').addEventListener('input', (event) => { draft.sections[0].lede = event.target.value; echo(); });
    window.addEventListener('message', (event) => {
      if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === 'meshx-cms-edit' && event.data.path === 'sections.0.lede') {
        draft.sections[0].lede = event.data.value; document.getElementById('intro').value = event.data.value; echo();
      }
    });
    </script>`;
  const writes: string[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Capture attempted writes to prove this isolated regression never saves or publishes content.
      writes.push(request.url());
    }
    if (url.origin !== 'https://hero-intro.test') {
      await route.fulfill({ body: '' });
      return;
    }
    if (url.pathname === '/api/landing-page') {
      await route.fulfill({ json: { published: document } });
      return;
    }
    if (['/editor', '/preview', '/live'].includes(url.pathname)) {
      await route.fulfill({
        contentType: 'text/html',
        body: url.pathname === '/editor' ? host : html,
      });
      return;
    }
    if (url.pathname.startsWith('/console/landing/') && !url.pathname.includes('..')) {
      try {
        const body = await readFile(
          `public/landing/${decodeURIComponent(url.pathname.slice('/console/landing/'.length))}`
        );
        const contentType = url.pathname.endsWith('.css')
          ? 'text/css'
          : url.pathname.endsWith('.js')
            ? 'application/javascript'
            : 'application/octet-stream';
        await route.fulfill({ contentType, body });
        return;
      } catch {
        /* Nonessential authored artwork is outside this rendering regression. */
      }
    }
    await route.fulfill({ body: '' });
  });
  await page.goto('https://hero-intro.test/editor');
  const intro = page.frameLocator('#preview').locator('[data-cms="sections.0.lede"]');
  await expect(intro).toBeVisible();
  await page.getByRole('textbox', { name: 'Intro text' }).fill('XXXXXXXX');
  await expect(intro).toHaveText('XXXXXXXX');
  await intro.screenshot({ path: info.outputPath('hero-intro-preview.png') });
  await intro.fill('Typed in the page');
  await expect(page.getByRole('textbox', { name: 'Intro text' })).toHaveValue('Typed in the page');
  await expect(intro).toBeFocused();
  const live = await context.newPage();
  await live.goto('https://hero-intro.test/live');
  await expect(live.locator('[data-cms="sections.0.lede"]')).toHaveText('XXXXXXXX');
  expect(writes).toEqual([]);
  await live.close();
});
