import { defineConfig, devices } from '@playwright/test';

// Browser tests for the static landing page's demo chat. The page is served from public/landing and
// the chat API is mocked inside each test, so these tests need no running Logto stack.
export default defineConfig({
  testDir: './tests/browser',
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
