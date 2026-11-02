import { startChatBrowserFixture } from './ai-chat-browser.test-helper.js';

it.each([
  'postgres://postgres:local-test-only@127.0.0.1:52969/frontend_ai_chat_test',
  'postgres://postgres:local-test-only@db.example:52970/frontend_ai_chat_test',
  'postgres://postgres:local-test-only@127.0.0.1:52970/production',
])('browser fixture refuses every non-owned database: %s', async (url) => {
  await expect(startChatBrowserFixture(url)).rejects.toThrow(
    'separately owned frontend disposable database'
  );
});
