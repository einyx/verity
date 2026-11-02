declare module '*core/build/routes/ai-chat-browser.test-helper.js' {
  export function startChatBrowserFixture(databaseUrl: string): Promise<{
    origin: string;
    close: () => Promise<void>;
  }>;
}
