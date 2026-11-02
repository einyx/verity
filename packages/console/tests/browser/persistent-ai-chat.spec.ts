/* eslint-disable max-lines -- Real-PG browser regressions share one isolated schema/server lifecycle. */
import path from 'node:path';

import {
  chatComposerGuard,
  chatSessionGuard,
  createSessionInputGuard,
  createTurnInputGuard,
  sessionPageGuard,
} from '@logto/schemas';
import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import svgr from 'vite-plugin-svgr';

// Only authentication/model/tool boundaries are synthetic. Routes, CAS, leases and persistence use
// the real core services and a separately owned PostgreSQL14 database. No page.route API mocks.
const owned = new Map<
  string,
  {
    vite?: ViteDevServer;
    backend?: { origin: string; close: () => Promise<void> };
    origin: string;
  }
>();
const current = () => owned.get('current') ?? { origin: '' };
test.beforeAll(async () => {
  if (!process.env.AI_CHAT_TEST_DATABASE_URL) {
    throw new Error('Explicit owned disposable AI_CHAT_TEST_DATABASE_URL required');
  }
  const { startChatBrowserFixture } =
    await import('../../../core/build/routes/ai-chat-browser.test-helper.js');
  const backend = await startChatBrowserFixture(process.env.AI_CHAT_TEST_DATABASE_URL);
  owned.set('current', { origin: '', backend });
  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    define: { 'process.env': {} },
    cacheDir: '.cache/node_modules/persistent-ai-chat-browser',
    resolve: { alias: { '@': path.resolve('src') } },
    server: { host: '127.0.0.1', port: 0, proxy: { '/api/': backend.origin } },
    plugins: [
      {
        name: 'isolated-persistent-chat-boundaries',
        enforce: 'pre',
        resolveId(id, importer) {
          const source = id.replace(`${path.resolve('src')}/`, '@/');
          if (
            ['@/hooks/use-theme', '@/consts/env', '@/cloud/hooks/use-landing-page'].includes(source)
          ) {
            return `\0fixture:${source}`;
          }
          if (importer?.includes('/Topbar/AiChat/') && id === './SetupBanner') {
            return '\0fixture:setup';
          }
        },
        load(id) {
          if (!id.startsWith('\0fixture:')) {
            return;
          }
          if (id.endsWith('use-theme')) {
            return "export default () => 'light';";
          }
          if (id.endsWith('consts/env')) {
            return 'export const isDevFeaturesEnabled = true;';
          }
          if (id.endsWith('use-landing-page')) {
            return "export const landingPageEditorKey = 'synthetic-editor';";
          }
          return 'export default () => null;';
        },
        configureServer(server) {
          server.middlewares.use('/__persistent-chat', async (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              await server.transformIndexHtml(
                '/__persistent-chat',
                '<html><body style="margin:0"><div id="app"></div><script type="module" src="/tests/browser/fixtures/persistent-ai-chat.tsx"></script></body></html>'
              )
            );
          });
        },
      },
      react(),
      svgr(),
    ],
  });
  owned.set('current', { ...current(), vite });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing owned port');
  }
  owned.set('current', { ...current(), origin: `http://127.0.0.1:${address.port}` });
});
test.afterAll(async () => {
  await current().vite?.close();
  await current().backend?.close();
});

for (const scenario of [
  { phase: 'creation', later: false, owner: 'fast-create-owner' },
  { phase: 'composer', later: false, owner: 'fast-composer-owner' },
  { phase: 'composer', later: true, owner: 'fast-newer-owner' },
] as const) {
  test(`first send awaiting ${scenario.phase} clears only its own draft; newer input=${scenario.later}`, async ({
    page,
  }) => {
    const release = new Map<string, () => void>();
    const held = new Map<string, string>();
    const turns = new Set<string>();
    const ready = new Promise<void>((resolve) => {
      release.set('ready', resolve);
    });
    const proceed = new Promise<void>((resolve) => {
      release.set('proceed', resolve);
    });
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/turns') && request.method() === 'POST') {
        turns.add(request.postData() ?? '');
      }
    });
    const pattern =
      scenario.phase === 'creation'
        ? '**/api/ai-chat/sessions'
        : '**/api/ai-chat/sessions/*/composer';
    await page.route(pattern, async (route) => {
      const expectedMethod = scenario.phase === 'creation' ? 'POST' : 'GET';
      if (route.request().method() !== expectedMethod || held.has('id')) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const id =
        scenario.phase === 'creation'
          ? chatSessionGuard.parse(await response.json()).id
          : new URL(route.request().url()).pathname.split('/').at(-2);
      if (!id) {
        throw new Error('Missing actual created session');
      }
      held.set('id', id);
      release.get('ready')?.();
      await proceed;
      await route.fulfill({ response });
    });
    try {
      await page.goto(`${current().origin}/__persistent-chat?owner=${scenario.owner}`);
      await page
        .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
        .click();
      const input = page.getByRole('textbox', {
        name: 'admin_console.inkeep_ai_bot.chat_placeholder',
      });
      await input.fill('Fast first prompt');
      await ready;
      const outgoing = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname.endsWith('/turns') && request.method() === 'POST'
      );
      await page
        .getByRole('button', { name: 'admin_console.inkeep_ai_bot.send', exact: true })
        .click();
      if (scenario.later) {
        await input.fill('Newer first-session draft');
        await page.locator('input[type="file"]').setInputFiles({
          name: 'newer.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Newer first-session file'),
        });
      }
      release.get('proceed')?.();
      const request = await outgoing;
      const payload = createTurnInputGuard.parse(request.postDataJSON());
      expect(payload.text).toBe('Fast first prompt');
      expect(payload.composerRevision).toBe(scenario.later ? 0 : 1);
      await expect(
        page.getByText('Synthetic reply: Fast first prompt', { exact: true })
      ).toBeVisible();
      await expect(input).toHaveValue(scenario.later ? 'Newer first-session draft' : '');
      if (scenario.later) {
        await expect(page.getByText('newer.txt', { exact: true })).toBeVisible();
      }
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      const response = await page.request.get(
        `${current().origin}/api/ai-chat/sessions/${held.get('id')}/composer`,
        { headers: { 'x-test-owner': scenario.owner } }
      );
      const stored = chatComposerGuard.parse(await response.json());
      expect(stored.text).toBe(scenario.later ? 'Newer first-session draft' : '');
      expect(stored.attachments).toHaveLength(scenario.later ? 1 : 0);
      expect(turns.size).toBe(1);
    } finally {
      release.get('proceed')?.();
    }
  });
}

test('a committed creation with a lost response preserves both drafts until explicit recovery', async ({
  page,
}) => {
  const owner = 'creation-loss-owner';
  const creations = new Map<number, { requestId: string; id: string }>();
  const forbidden = new Set<string>();
  page.on('request', (request) => {
    if (
      /\/(?:turns|actions|reviews)(?:\/|$)/u.test(new URL(request.url()).pathname) &&
      request.method() === 'POST'
    ) {
      forbidden.add(request.url());
    }
  });
  await page.route('**/api/ai-chat/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const input = createSessionInputGuard.parse(route.request().postDataJSON());
    // Commit through the real API/PG store first; lose only its first transport response.
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    const created = chatSessionGuard.parse(await response.json());
    creations.set(creations.size, { requestId: input.requestId, id: created.id });
    await (creations.size === 1 ? route.abort('failed') : route.fulfill({ response }));
  });
  await page.goto(`${current().origin}/__persistent-chat?owner=${owner}`);
  await page
    .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
    .click();
  const input = page.getByRole('textbox', { name: 'admin_console.inkeep_ai_bot.chat_placeholder' });
  await input.fill('Original unbound browser draft');
  await expect(page.getByText(/Your draft is preserved/u)).toBeVisible();
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  const history = page.getByRole('navigation', { name: 'Conversation history' });
  await expect(history.locator('ul button')).toHaveCount(1);
  await history.locator('ul button').first().click();
  await expect(input).toHaveValue('');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await input.fill('Newer browser draft');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'newer.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Newer unsent file'),
  });
  await history.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(
    page.getByText(/original unsaved draft and the newer conversation draft are both preserved/u)
  ).toBeVisible();
  await expect(input).toHaveValue('Newer browser draft');
  await expect(page.getByText('newer.txt', { exact: true })).toBeVisible();
  expect(creations.get(1)).toEqual(creations.get(0));
  const historyResponse = await page.request.get(`${current().origin}/api/ai-chat/sessions`, {
    headers: { 'x-test-owner': owner },
  });
  const before = sessionPageGuard(chatSessionGuard).parse(await historyResponse.json());
  expect(before.items).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Recover original draft in a new conversation', exact: true })
    .click();
  await expect(input).toHaveValue('Original unbound browser draft');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(creations.get(2)?.requestId).not.toBe(creations.get(0)?.requestId);
  await page.getByRole('tab').first().click();
  await expect(input).toHaveValue('Newer browser draft');
  await expect(page.getByText('newer.txt', { exact: true })).toBeVisible();
  await page.clock.runFor(700);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const first = await page.request.get(
    `${current().origin}/api/ai-chat/sessions/${creations.get(0)?.id}/composer`,
    { headers: { 'x-test-owner': owner } }
  );
  const recovered = await page.request.get(
    `${current().origin}/api/ai-chat/sessions/${creations.get(2)?.id}/composer`,
    { headers: { 'x-test-owner': owner } }
  );
  expect(chatComposerGuard.parse(await first.json())).toMatchObject({
    text: 'Newer browser draft',
    attachments: [{ name: 'newer.txt', text: 'Newer unsent file' }],
  });
  expect(chatComposerGuard.parse(await recovered.json()).text).toBe(
    'Original unbound browser draft'
  );
  expect([...forbidden]).toEqual([]);
});

for (const width of [390, 768, 1440]) {
  test(`durable drafts, two sessions, late completion, reload and owner denial at ${width}px`, async ({
    page,
    browser,
  }, testInfo) => {
    const owner = `owner-${width}`;
    const url = `${current().origin}/__persistent-chat?owner=${owner}`;
    const errors = new Set<string>();
    page.on('pageerror', (error) => {
      errors.add(error.message);
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    await page
      .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
      .click();
    const input = page.getByRole('textbox', {
      name: 'admin_console.inkeep_ai_bot.chat_placeholder',
    });
    await input.fill(`First draft ${width}`);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const firstId = await page.getByRole('tab', { selected: true }).getAttribute('id');
    if (!firstId) {
      throw new Error('Missing first tab');
    }
    if (width < 801) {
      await page.getByRole('button', { name: 'History', exact: true }).click();
    }
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    if (await page.getByRole('button', { name: 'Close history' }).isVisible()) {
      await page.getByRole('button', { name: 'Close history' }).click();
    }
    await input.fill(`Second draft ${width}`);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic unsent attachment'),
    });
    await expect(page.getByText('notes.txt', { exact: true })).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.getByRole('tab').first().click();
    await expect(input).toHaveValue(`First draft ${width}`);
    await page
      .getByRole('button', { name: 'admin_console.inkeep_ai_bot.send', exact: true })
      .click();
    await page.getByRole('tab').last().click();
    await expect(input).toHaveValue(`Second draft ${width}`);
    await page.getByRole('tab').last().focus();
    await page.getByRole('tab').last().press('Home');
    await expect(page.getByRole('tab').first()).toBeFocused();
    await page.getByRole('tab').first().press('End');
    await expect(page.getByRole('tab').last()).toBeFocused();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    const bounds = await input.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`persistent-${width}.png`) });
    expect(
      await page
        .getByRole('dialog')
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
    await page.waitForTimeout(1200);
    await expect(
      page.getByText(`Synthetic reply: First draft ${width}`, { exact: true })
    ).toHaveCount(0);
    await page.getByRole('tab').first().click();
    await expect(
      page.getByText(`Synthetic reply: First draft ${width}`, { exact: true })
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
      .click();
    await expect(
      page.getByText(`Synthetic reply: First draft ${width}`, { exact: true })
    ).toBeVisible();
    await page.getByRole('tab').last().click();
    await expect(input).toHaveValue(`Second draft ${width}`);
    const second = await browser.newContext();
    await expect(page.getByText('notes.txt', { exact: true })).toBeVisible();
    try {
      const another = await second.newPage();
      await another.goto(url);
      await another
        .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
        .click();
      if (width < 801) {
        /* New context uses the desktop viewport. */
      }
      await expect(another.getByRole('navigation', { name: 'Conversation history' })).toBeVisible();
      await another
        .getByRole('navigation', { name: 'Conversation history' })
        .getByRole('button', { name: new RegExp(`Second draft ${width}`, 'u') })
        .click();
      await expect(
        another.getByRole('textbox', { name: 'admin_console.inkeep_ai_bot.chat_placeholder' })
      ).toHaveValue(`Second draft ${width}`);
      await expect(another.getByText('notes.txt', { exact: true })).toBeVisible();
      const history = await another.request.get(`${current().origin}/api/ai-chat/sessions`, {
        headers: { 'x-test-owner': owner },
      });
      const data = sessionPageGuard(chatSessionGuard).parse(await history.json());
      expect(data.items).toHaveLength(2);
      const denied = await another.request.get(
        `${current().origin}/api/ai-chat/sessions/${data.items[0]?.id}/composer`,
        { headers: { 'x-test-owner': 'different-owner' } }
      );
      expect(denied.status()).toBe(404);
    } finally {
      await second.close();
    }
    expect([...errors]).toEqual([]);
  });
}

test('two devices preserve conflicting drafts; archive, restore and delete are explicit; review outcomes survive reload', async ({
  page,
  browser,
}) => {
  const owner = 'multi-device-owner';
  const url = `${current().origin}/__persistent-chat?owner=${owner}`;
  const inputName = 'admin_console.inkeep_ai_bot.chat_placeholder';
  const open = async (target: typeof page) => {
    await target.goto(url);
    await target
      .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
      .click();
  };
  await open(page);
  await page.getByRole('textbox', { name: inputName }).fill('Conflict seed');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await open(other);
    await other
      .getByRole('navigation', { name: 'Conversation history' })
      .getByRole('button', { name: /Conflict seed/u })
      .click();
    await expect(other.getByRole('textbox', { name: inputName })).toHaveValue('Conflict seed');
    await page.getByRole('textbox', { name: inputName }).fill('Main device changed');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await other.getByRole('textbox', { name: inputName }).fill('Keep this second-device text');
    await expect(other.getByRole('button', { name: 'Replace server draft' })).toBeVisible();
    await expect(other.getByRole('textbox', { name: inputName })).toHaveValue(
      'Keep this second-device text'
    );
    await other.getByRole('button', { name: 'Replace server draft' }).click();
    await expect(other.getByText('Saved', { exact: true })).toBeVisible();
    await page.getByRole('tab').click();
    await expect(page.getByRole('textbox', { name: inputName })).toHaveValue(
      'Keep this second-device text'
    );
    await page.getByRole('textbox', { name: inputName }).fill('review synthetic organization');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'admin_console.inkeep_ai_bot.send', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeDisabled();
    const confirm = page.getByRole('button', {
      name: 'admin_console.inkeep_ai_bot.action_confirm',
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await page.reload();
    await page
      .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
      .click();
    await expect(confirm).toBeVisible();
    await confirm.click(); // Mocked tool executor only; persists the real action outcome.
    await expect(
      page.getByText('admin_console.inkeep_ai_bot.action_done', { exact: true })
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label', exact: true })
      .click();
    await expect(
      page.getByText('admin_console.inkeep_ai_bot.action_done', { exact: true })
    ).toBeVisible();
    await expect(confirm).toHaveCount(0);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Conversation history' })
      .getByRole('button', { name: /Conflict seed/u })
      .click();
    await expect(page.getByText('Archived conversation · restore to continue')).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByRole('textbox', { name: inputName })).toBeVisible();
    await page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.getByRole('alert').filter({ hasText: 'Action audit records' })).toContainText(
      'including action arguments and results, are retained separately'
    );
    await page.getByRole('button', { name: 'Delete conversation history', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeFocused({
      timeout: 2000,
    });
  } finally {
    await second.close();
  }
});
/* eslint-enable max-lines */
