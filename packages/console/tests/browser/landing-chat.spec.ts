import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

const landingRoot = path.resolve('public/landing');
const landingBase = 'http://localhost/console/landing/';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Serves the landing directory from disk, mocks the chat API, and aborts every other request. */
const routeLanding = async (page: Page, chatStatus: number, chatBody: unknown) => {
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());

    // The launcher opens the chat only when the published document switches the demo chat on.
    if (url.pathname === '/api/landing-page') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ published: { demoChat: { enabled: true } } }),
      });
    }

    if (url.pathname === '/api/landing-page/chat') {
      return route.fulfill({
        status: chatStatus,
        contentType: 'application/json',
        body: JSON.stringify(chatBody),
      });
    }

    // No Turnstile site key by default, so the chat draws no widget unless a test sets one.
    if (url.pathname === '/api/landing-page/chat/config') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ turnstileSiteKey: null }),
      });
    }

    if (url.host === 'localhost' && url.pathname.startsWith('/console/landing/')) {
      const relative = url.pathname.slice('/console/landing/'.length) || 'index.html';
      const file = path.join(landingRoot, relative);

      if (!file.startsWith(landingRoot)) {
        return route.abort();
      }

      try {
        const body = await readFile(file);
        const extension = path.extname(file);

        await route.fulfill({
          status: 200,
          contentType: contentTypes[extension] ?? 'application/octet-stream',
          body,
        });
        return;
      } catch {
        return route.fulfill({ status: 404, body: 'not found' });
      }
    }

    return route.abort();
  });
};

const openChat = async (page: Page) => {
  await page.goto(`${landingBase}index.html`);
  await page.locator('a[href="#demo-chat"]').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const sendMessage = async (page: Page, text: string) => {
  await page.getByLabel('Your message').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
};

test.describe('landing demo chat', () => {
  test.describe('when the chat request fails for a German visitor', () => {
    test.use({ locale: 'de-DE' });

    test('shows the German failure notice in an alert', async ({ page }) => {
      await routeLanding(page, 503, { message: 'unavailable' });
      await openChat(page);

      await sendMessage(page, 'Hallo');

      await expect(page.getByRole('alert')).toContainText('Ihre Nachricht wurde nicht übermittelt');
    });
  });

  test.describe('when the chat request fails for a language the chat does not support', () => {
    test.use({ locale: 'xx-XX' });

    test('falls back to the English failure notice', async ({ page }) => {
      await routeLanding(page, 503, { message: 'unavailable' });
      await openChat(page);

      await sendMessage(page, 'Hello');

      await expect(page.getByRole('alert')).toContainText("Your message didn't go through");
    });
  });

  test.describe('consent', () => {
    test.use({ locale: 'en-US' });

    test('asks for consent with Yes and No, and sends the choice the visitor makes', async ({
      page,
    }) => {
      await routeLanding(page, 200, { reply: 'unused' });

      // The server asks for consent before it saves a lead. This stands in for that reply: the
      // consent question with its Yes | No options. A No gets the decline reply, which ends the lead.
      const sent: string[] = [];
      await page.route('**/api/landing-page/chat', async (route) => {
        const body: unknown = route.request().postDataJSON();
        const message =
          typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
        // The test records every visitor message in the order it was sent.
        // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- the list is the record of requests, in order
        sent.push(String(message));

        const declined = message === 'No';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            declined
              ? { reply: 'No problem at all, we will not send your details.', options: [] }
              : { reply: 'May we contact you about your demo?', options: ['Yes', 'No'] }
          ),
        });
      });

      await openChat(page);
      await sendMessage(page, 'I would like a demo');

      await expect(page.getByRole('button', { name: 'Yes' })).toBeVisible();
      await page.getByRole('button', { name: 'No' }).click();

      await expect(
        page.getByText('No problem at all, we will not send your details.')
      ).toBeVisible();
      expect(sent).toEqual(['I would like a demo', 'No']);
    });
  });

  test.describe('turnstile', () => {
    test.use({ locale: 'en-US' });

    test('sends the Turnstile token with the first message of a new session', async ({ page }) => {
      await routeLanding(page, 200, { reply: 'unused' });

      // The site key is served, and Cloudflare's script is replaced by a stand-in that hands back a token.
      await page.route('**/api/landing-page/chat/config', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ turnstileSiteKey: 'test-site-key' }),
        });
      });
      await page.route('https://challenges.cloudflare.com/**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/javascript',
          body: "window.turnstile = { render: function (container, options) { setTimeout(function () { options.callback('test-token'); }, 0); return 'widget-1'; }, reset: function () {} };",
        });
      });

      const sent: unknown[] = [];
      await page.route('**/api/landing-page/chat', async (route) => {
        // The test records each chat request in the order it was sent.
        // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- the list is the record of requests, in order
        sent.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ reply: 'Thanks for the details.' }),
        });
      });

      await openChat(page);
      await sendMessage(page, 'I would like a demo');

      await expect(page.getByText('Thanks for the details.')).toBeVisible();
      expect(sent[0]).toMatchObject({ turnstileToken: 'test-token' });
    });
  });

  test.describe('accessibility', () => {
    test.use({ locale: 'en-US' });

    test('names the dialog, the message input and the send button', async ({ page }) => {
      await routeLanding(page, 200, { reply: 'Hi there' });
      await openChat(page);

      await expect(page.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'demo-chat-title');
      await expect(page.getByLabel('Your message')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
    });
  });
});
