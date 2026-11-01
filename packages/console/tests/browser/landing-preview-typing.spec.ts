import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test('keeps slow typing and the caret in an added section positioned before the hero', async ({
  page,
}) => {
  const [html, renderer, elements, cms] = await Promise.all([
    readFile('public/landing/index.html', 'utf8'),
    readFile('public/landing/landing-renderer.js', 'utf8'),
    readFile('public/landing/landing-elements.js', 'utf8'),
    readFile('public/landing/cms.js', 'utf8'),
  ]);
  const fixture = {
    sections: [
      { id: 'typing', type: 'text', heading: 'Typing here', body: 'Body' },
      { id: 'problem', type: 'fomo' },
      { id: 'hero', type: 'hero' },
      { id: 'closing', type: 'closingCta' },
    ],
  };
  const preview =
    html.replaceAll(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, '') +
    '<script src="/landing-renderer.js"></script><script src="/landing-elements.js"></script><script src="/cms.js"></script>';
  const host = `<!doctype html><iframe id="preview" src="/preview?cmsPreview=1" style="width:100%;height:900px"></iframe><output id="typed"></output>
    <script>
      const frame = document.getElementById('preview');
      const draft = ${JSON.stringify(fixture)};
      const echo = () => frame.contentWindow.postMessage({ type: 'meshx-cms-draft', doc: draft }, location.origin);
      frame.addEventListener('load', echo);
      window.addEventListener('message', (event) => {
        if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
        if (event.data?.type === 'meshx-cms-edit' && event.data.path === 'sections.0.heading') {
          draft.sections[0].heading = event.data.value;
          document.getElementById('typed').textContent = event.data.value;
          echo();
        }
      });
    </script>`;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://landing-preview.test') {
      await route.fulfill({ contentType: 'text/plain', body: '' });
      return;
    }
    const { pathname } = url;
    const scripts: Record<string, string> = {
      '/landing-renderer.js': renderer,
      '/landing-elements.js': elements,
      '/cms.js': cms,
    };
    if (scripts[pathname]) {
      await route.fulfill({ contentType: 'application/javascript', body: scripts[pathname] });
      return;
    }
    await route.fulfill({
      contentType: 'text/html',
      body: pathname === '/editor' ? host : pathname === '/preview' ? preview : '',
    });
  });
  await page.goto('https://landing-preview.test/editor');
  const field = page.frameLocator('#preview').locator('[data-cms="sections.0.heading"]');
  await expect(field).toHaveText('Typing here');
  await field.fill('');
  // Longer than the bridge's input debounce: every character receives a real draft echo.
  await field.pressSequentially('Slow typing stays focused', { delay: 180 });
  await expect(page.locator('#typed')).toHaveText('Slow typing stays focused');
  await expect(field).toBeFocused();
  await field.evaluate((element) => {
    const text = element.firstChild;
    const selection = window.getSelection();
    if (!text || !selection) {
      throw new Error('Editable text and browser selection must be available');
    }
    const range = document.createRange();
    range.setStart(text, 4);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type('X');
  await expect(page.locator('#typed')).toHaveText('SlowX typing stays focused');
  await expect.poll(async () => field.evaluate(() => window.getSelection()?.anchorOffset)).toBe(5);
  await expect(field).toBeFocused();
});
