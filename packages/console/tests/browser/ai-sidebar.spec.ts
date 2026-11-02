/* eslint-disable max-lines -- The synthetic workspace scenarios share one isolated Vite lifecycle and accessibility helpers. */
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer, type ViteDevServer } from 'vite';
import svgr from 'vite-plugin-svgr';

// Synthetic coverage for the topbar-only AI workspace. The persistent left rail was deliberately
// superseded, so these tests exercise the temporary History dialog (light/dark, 320px and the
// 200%-400% zoom-equivalent widths), the top conversation tab strip and the SessionControls action
// menu — all rendered by fixtures/ai-sidebar.tsx with local state only. No real chats, network,
// provider or API are involved, and rendering never creates a session.
const owned = new Map<string, { instance: ViteDevServer; origin: string }>();
const origin = () => owned.get('fixture')?.origin ?? '';

const startServer = async () => {
  const instance = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: '.cache/node_modules/ai-sidebar',
    define: { 'process.env': {} },
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
  await instance.listen();
  const address = instance.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture port');
  }
  return { instance, origin: `http://127.0.0.1:${address.port}` };
};

test.beforeAll(async () => {
  owned.set('fixture', await startServer());
});

test.afterAll(async () => {
  await owned.get('fixture')?.instance.close();
});

const historyDialog = (page: Page) => page.getByRole('dialog', { name: 'Conversation history' });
const historyTrigger = (page: Page) => page.getByRole('button', { name: 'History', exact: true });
// The AiWorkspace main section is aria-hidden + inert while the History or actions dialog is open,
// so role-based locators cannot resolve workspace content behind a modal. This DOM locator keeps
// attribute and size checks on the History trigger working while the dialog is open.
const historyTriggerNode = (page: Page) => page.locator('button[aria-controls="chat-history"]');
const workspaceMain = (page: Page) => page.locator('[data-ai-workspace-main]');
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send' });
const conversationList = (page: Page) => page.getByRole('list', { name: 'Conversations' });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const counters = (page: Page) => page.locator('[data-new-chat-count]');

const openHistory = async (page: Page) => {
  await historyTrigger(page).click();
  await expect(historyDialog(page)).toBeVisible();
};

const markDraftNode = async (box: Locator) =>
  box.evaluate((element) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Mark only the synthetic DOM node to detect composer remounts.
    element.dataset.fixtureIdentity = 'true';
  });

const draftNodeSurvived = async (box: Locator) =>
  box.evaluate((element) => element.dataset.fixtureIdentity === 'true');

const heightOf = async (box: Locator) =>
  box.evaluate((element) => element.getBoundingClientRect().height);

const contrastRatio = async (text: Locator) =>
  text.evaluate((element): number => {
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
    // eslint-disable-next-line unicorn/consistent-function-scoping -- This function must be serialized into the browser evaluation closure.
    const luminance = (color: string) => {
      const [red = 0, green = 0, blue = 0] = (color.match(/[\d.]+/g) ?? [])
        .slice(0, 3)
        .map((value) => {
          const channel = Number(value) / 255;
          return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    const foreground = luminance(view.getComputedStyle(element).color);
    const background = luminance(surface(element));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });

/** The fixture must stay synthetic: every request has to hit the local Vite origin. */
const trackExternalRequests = (page: Page) => {
  const violations = new Set<string>();
  page.on('request', (request) => {
    if (!request.url().startsWith(origin())) {
      violations.add(request.url());
    }
  });
  return violations;
};

for (const theme of ['light', 'dark']) {
  test(`${theme}: History dialog contrast, compact rows, bounded scrolling, Escape and outside-click dismissal keep the draft`, async ({
    page,
  }, testInfo) => {
    const violations = trackExternalRequests(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(`${origin()}/__sidebar?theme=${theme}`);

    // Nothing is disclosed or created by rendering alone.
    await expect(historyDialog(page)).toHaveCount(0);
    await expect(counters(page)).toHaveAttribute('data-new-chat-count', '0');
    await expect(historyTrigger(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(historyTrigger(page)).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(historyTrigger(page)).toHaveAttribute('aria-controls', 'chat-history');

    const draft = composer(page);
    await draft.fill('Synthetic unsent draft');
    await markDraftNode(draft);

    // The enabled synthetic .demo-chat-send keeps its primary-hover/layer-1 pairing readable in
    // both themes.
    expect(await contrastRatio(sendButton(page))).toBeGreaterThanOrEqual(4.5);

    await openHistory(page);

    // The whole workspace goes aria-hidden + inert behind the dialog while react-modal's nested
    // aria-hidden counters stay balanced; role locators cannot resolve behind it.
    await expect(historyTriggerNode(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(workspaceMain(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(workspaceMain(page)).toHaveAttribute('inert');

    // Conversation rows stay compact: clamped two-line title above the date.
    const current = page.locator('button[aria-current="true"]');
    await expect(current).toBeVisible();
    const title = current.locator('span').first();
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

    // Text stays readable on opaque surfaces in both themes.
    await Promise.all(
      [
        historyDialog(page).getByRole('heading', { name: 'Conversation history' }),
        title,
        current.locator('time'),
        page.getByText('Search conversation titles (120 characters)'),
        page.getByText('Ask meshX'),
      ].map(async (text) => {
        expect(await contrastRatio(text)).toBeGreaterThanOrEqual(4.5);
      })
    );

    // The conversation list scrolls on its own without moving the dialog.
    const list = conversationList(page);
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true
    );
    await list.focus();
    await page.keyboard.press('End');
    await expect.poll(async () => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(list.getByRole('button', { name: 'Synthetic conversation 15' })).toBeInViewport();

    // Rows and toolbar controls keep usable target sizes with a visible focus outline.
    const second = list.getByRole('button').nth(1);
    await second.focus();
    await expect(second).toBeFocused();
    expect(await heightOf(second)).toBeGreaterThanOrEqual(24);
    expect(
      await second.evaluate(
        (element) => element.ownerDocument.defaultView?.getComputedStyle(element).outlineStyle
      )
    ).toBe('solid');
    expect(await heightOf(historyTriggerNode(page))).toBeGreaterThanOrEqual(36);

    await page.screenshot({ path: testInfo.outputPath(`history-${theme}.png`) });

    await page.keyboard.press('Escape');
    await expect(historyDialog(page)).toHaveCount(0);
    await expect(historyTrigger(page)).toBeFocused();
    await expect(historyTrigger(page)).toHaveAttribute('aria-expanded', 'false');
    // Dismissal restores the workspace interaction state.
    await expect(workspaceMain(page)).not.toHaveAttribute('inert');

    // Clicking the overlay outside the dialog dismisses it the same way.
    await openHistory(page);
    await page.mouse.click(10, 10);
    await expect(historyDialog(page)).toHaveCount(0);
    await expect(historyTrigger(page)).toBeFocused();

    // The draft survives every toggle, on the very same textarea node.
    await expect(draft).toHaveValue('Synthetic unsent draft');
    expect(await draftNodeSurvived(draft)).toBe(true);
    await expect(counters(page)).toHaveAttribute('data-new-chat-count', '0');
    expect([...violations]).toEqual([]);
  });
}

for (const [width, zoom] of [
  [640, '200%'],
  [320, '400%'],
] as const) {
  test(`history sheet at ${zoom} zoom-equivalent width (${width}px) stays full-width with Escape and focus restore`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${origin()}/__sidebar`);
    const draft = composer(page);
    await draft.fill('Synthetic unsent draft');

    await openHistory(page);

    // Below 800px the dialog docks to the bottom edge as a full-width sheet.
    const sheet = historyDialog(page);
    const box = await sheet.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(width - 24);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual(800 - 20);
    expect(
      await page.locator('html').evaluate((element) => element.scrollWidth)
    ).toBeLessThanOrEqual(width);

    // Zoom-equivalent widths keep touch-sized controls and non-cramped rows.
    expect(await heightOf(historyTriggerNode(page))).toBeGreaterThanOrEqual(44);
    expect(
      await heightOf(page.getByRole('button', { name: 'Recent', exact: true }))
    ).toBeGreaterThanOrEqual(40);
    expect(
      await heightOf(conversationList(page).getByRole('button').first())
    ).toBeGreaterThanOrEqual(24);

    await page.screenshot({ path: testInfo.outputPath(`history-sheet-${width}.png`) });

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(historyTrigger(page)).toBeFocused();
    await expect(draft).toHaveValue('Synthetic unsent draft');
  });
}

test('selecting a conversation closes History through the dismiss callback and keeps the draft', async ({
  page,
}, testInfo) => {
  const violations = trackExternalRequests(page);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${origin()}/__sidebar`);
  const draft = composer(page);
  await draft.fill('Synthetic unsent draft');
  await markDraftNode(draft);

  await openHistory(page);
  await page.screenshot({ path: testInfo.outputPath('history-before-selection.png') });

  const target = conversationList(page).getByRole('button', {
    name: 'Sign-in investigation notes',
  });
  await target.focus();
  await page.keyboard.press('Enter');

  // The SessionSidebar selection callback calls AiWorkspace's dismiss closure.
  await expect(historyDialog(page)).toHaveCount(0);
  await expect(historyTrigger(page)).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Sign-in investigation notes' })).toHaveAttribute(
    'aria-selected',
    'true'
  );

  // Reopening confirms the selection without any session creation side effect.
  await openHistory(page);
  await expect(
    conversationList(page).getByRole('button', { name: 'Sign-in investigation notes' })
  ).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape');
  await expect(historyTrigger(page)).toBeFocused();

  await expect(draft).toHaveValue('Synthetic unsent draft');
  expect(await draftNodeSurvived(draft)).toBe(true);
  await expect(counters(page)).toHaveAttribute('data-new-chat-count', '0');
  expect([...violations]).toEqual([]);
});

test('search narrows the Recent and Archived lists and empty/loading states keep filters available', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${origin()}/__sidebar`);
  await openHistory(page);

  const searchBox = page.getByRole('searchbox', {
    name: 'Search conversation titles (120 characters)',
  });
  const recent = page.getByRole('button', { name: 'Recent', exact: true });
  const archived = page.getByRole('button', { name: 'Archived', exact: true });
  await expect(recent).toHaveAttribute('aria-pressed', 'true');
  await expect(conversationList(page).getByRole('button')).toHaveCount(16);

  await searchBox.fill('sign-in');
  await expect(searchBox).toHaveValue('sign-in');
  await expect(conversationList(page).getByRole('button')).toHaveCount(1);
  await expect(
    conversationList(page).getByRole('button', { name: 'Sign-in investigation notes' })
  ).toHaveCount(1);

  // The 120-code-point guard rejects longer input wholesale instead of clamping it, so the
  // previous query and its results stay untouched.
  await searchBox.fill('a'.repeat(130));
  await expect(searchBox).toHaveValue('sign-in');
  await expect(conversationList(page).getByRole('button')).toHaveCount(1);

  await searchBox.fill('');
  await expect(conversationList(page).getByRole('button')).toHaveCount(16);

  await archived.click();
  await expect(archived).toHaveAttribute('aria-pressed', 'true');
  await expect(recent).toHaveAttribute('aria-pressed', 'false');
  await expect(conversationList(page).getByRole('button')).toHaveCount(3);
  await searchBox.fill('sign-in');
  await expect(
    conversationList(page).getByRole('button', { name: 'Sign-in audit archive' })
  ).toHaveCount(1);
  await searchBox.fill('');
  await page.screenshot({ path: testInfo.outputPath('history-archived-filter.png') });
  await expect(
    conversationList(page).getByRole('button', { name: 'Synthetic archived brainstorm sweep' })
  ).toHaveCount(1);

  await page.goto(`${origin()}/__sidebar?empty`);
  await openHistory(page);
  await expect(page.getByText('No conversations yet')).toBeVisible();
  await expect(recent).toBeVisible();
  await expect(archived).toBeVisible();

  await page.goto(`${origin()}/__sidebar?empty&loading`);
  await openHistory(page);
  await expect(page.getByRole('status')).toHaveText('Loading conversations…');
  await expect(page.getByText('No conversations yet')).toHaveCount(0);
  await expect(conversationList(page).getByRole('button')).toHaveCount(0);
});

test('conversation tabs move focus with arrow keys and scroll the strip; New chat stays click-driven', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${origin()}/__sidebar`);
  const strip = page.getByRole('tablist', { name: 'Open conversations' });
  const tabs = strip.getByRole('tab');
  await expect(tabs).toHaveCount(6);

  // Six long synthetic tabs overflow the strip, which scrolls horizontally on its own.
  expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await heightOf(tabs.first())).toBeGreaterThanOrEqual(44);

  const selected = () => strip.getByRole('tab', { selected: true });
  await selected().focus();
  await expect(selected()).toBeFocused();
  expect(
    await selected().evaluate(
      (element) => element.ownerDocument.defaultView?.getComputedStyle(element).outlineStyle
    )
  ).toBe('solid');

  await page.keyboard.press('ArrowRight');
  await expect(selected()).toBeFocused();
  await expect(selected()).toHaveText(/Sign-in investigation notes/);
  await page.keyboard.press('End');
  await expect(selected()).toBeFocused();
  await expect.poll(async () => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  await expect(selected()).toBeFocused();

  // Only the explicit New chat control creates a session, never a render pass.
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(counters(page)).toHaveAttribute('data-new-chat-count', '1');
  await expect(tabs).toHaveCount(7);
  await expect(strip.getByRole('tab', { name: 'Fresh synthetic chat 1' })).toHaveAttribute(
    'aria-selected',
    'true'
  );

  await openHistory(page);
  await expect(
    conversationList(page).getByRole('button', { name: 'Fresh synthetic chat 1' })
  ).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('history-new-chat.png') });
  await page.keyboard.press('Escape');
  await expect(historyTrigger(page)).toBeFocused();
});

test('conversation actions require an explicit delete confirmation through the synthetic callback', async ({
  page,
}, testInfo) => {
  const violations = trackExternalRequests(page);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${origin()}/__sidebar`);
  const actions = page.getByRole('button', { name: 'Conversation actions' });
  const countersRoot = page.locator('[data-removed-count]');

  // No menu, no composer duplication and no mutation before an explicit choice.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(1);
  await expect(countersRoot).toHaveAttribute('data-removed-count', '0');

  await actions.click();
  const menu = page.getByRole('menu', { name: 'Conversation actions' });
  await expect(menu).toBeVisible();
  await expect(countersRoot).toHaveAttribute('data-changed-count', '0');
  await expect(countersRoot).toHaveAttribute('data-removed-count', '0');
  // The actions dialog also aria-hides and inerts the workspace through isActionsOpen.
  await expect(historyTriggerNode(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(workspaceMain(page)).toHaveAttribute('inert');
  await page.screenshot({ path: testInfo.outputPath('actions-menu.png') });

  await page.getByRole('menuitem', { name: 'Delete conversation…' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Delete conversation' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(
    'Action audit records, including action arguments and results, are retained separately.'
  );
  // The conversation survives while only the confirmation is on screen (tab strip is aria-hidden
  // behind the modal, so text matching is used).
  await expect(
    page.getByText('Synthetic workspace review with an exceptionally long title')
  ).toHaveCount(1);
  await expect(countersRoot).toHaveAttribute('data-removed-count', '0');
  await page.screenshot({ path: testInfo.outputPath('actions-delete-confirm.png') });

  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(actions).toBeFocused();
  await expect(workspaceMain(page)).not.toHaveAttribute('inert');
  await expect(countersRoot).toHaveAttribute('data-removed-count', '0');

  // Explicit confirmation is the only path that removes the conversation and its tab.
  await actions.click();
  await expect(menu).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete conversation…' }).click();
  await expect(confirmation).toBeVisible();
  await page.getByRole('button', { name: 'Delete conversation history' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(countersRoot).toHaveAttribute('data-removed-count', '1');
  await expect(
    page.getByText('Synthetic workspace review with an exceptionally long title')
  ).toHaveCount(0);
  // Deleting the active conversation moves the selection to the neighboring tab, whose controls
  // stay available.
  await expect(actions).toBeVisible();
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);

  await openHistory(page);
  await expect(
    conversationList(page).getByRole('button', { name: 'Synthetic workspace review' })
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect([...violations]).toEqual([]);
});

test('archived conversations restore into the Recent list through the action menu', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${origin()}/__sidebar?archived-active`);
  const actions = page.getByRole('button', { name: 'Conversation actions' });
  const countersRoot = page.locator('[data-changed-count]');

  // The active conversation is archived: absent from Recent, present under Archived.
  await openHistory(page);
  const list = conversationList(page);
  await expect(
    list.getByRole('button', { name: 'Synthetic archived brainstorm sweep' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  const archivedRow = list.getByRole('button', { name: 'Synthetic archived brainstorm sweep' });
  await expect(archivedRow).toHaveCount(1);
  await expect(archivedRow).toHaveAttribute('aria-current', 'true');
  // Leave the Recent filter selected for the post-restore assertion.
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(historyTrigger(page)).toBeFocused();

  await actions.click();
  await expect(page.getByRole('menu', { name: 'Conversation actions' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeDisabled();
  await expect(countersRoot).toHaveAttribute('data-changed-count', '0');

  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(countersRoot).toHaveAttribute('data-changed-count', '1');
  await expect(actions).toBeFocused();

  await openHistory(page);
  await expect(page.getByRole('button', { name: 'Recent', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const restored = conversationList(page).getByRole('button', {
    name: 'Synthetic archived brainstorm sweep',
  });
  await expect(restored).toHaveCount(1);
  await expect(restored).toHaveAttribute('aria-current', 'true');
  await page.screenshot({ path: testInfo.outputPath('archived-restored.png') });
  await page.keyboard.press('Escape');
  await expect(historyTrigger(page)).toBeFocused();
});
/* eslint-enable max-lines */
