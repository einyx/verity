import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as ReactTypes from 'react';

import AiChat from './LegacyAiChat';

jest.mock('@/components/LandingChat/demo-chat.css', () => ({}));

const mockRuntime = { hasMessages: false };
const mockSend = jest.fn(() => {
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Represents retained runtime conversation state without calling an AI provider.
  mockRuntime.hasMessages = true;
});
const mockReady = jest.fn();
jest.mock('@/consts/env', () => ({ isDevFeaturesEnabled: true }));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('./SetupBanner', () => ({
  __esModule: true,
  default: () => <button type="button">Agent setup</button>,
}));
jest.mock('./Thread', () => ({ __esModule: true, default: () => <p>Retained conversation</p> }));
jest.mock('./Conversation', () => {
  const React = jest.requireActual<typeof ReactTypes>('react');
  function MockConversation({
    children,
    onReady,
  }: {
    readonly children: ReactTypes.ReactNode;
    readonly onReady: (api: { send: (text: string) => void }) => void;
  }) {
    React.useEffect(() => {
      mockReady();
      onReady({ send: mockSend });
    }, [onReady]);
    return <div>{children}</div>;
  }
  return { __esModule: true, default: MockConversation };
});
jest.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: { thread: { messages: unknown[] } }) => boolean) =>
    select({ thread: { messages: mockRuntime.hasMessages ? [{}] : [] } }),
}));

beforeEach(() => {
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Reset only the test runtime between cases.
  mockRuntime.hasMessages = false;
  mockSend.mockClear();
  mockReady.mockClear();
});

it('reserves Shift+CmdK for navigation while plain CmdK opens AI', () => {
  render(<AiChat />);
  fireEvent.keyDown(window, { key: 'K', metaKey: true, shiftKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('retains an unsent draft and its one runtime when its sidebar trigger collapses', async () => {
  const view = render(<AiChat isSidebar />);
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Unsent shell draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
  view.rerender(<AiChat isSidebar isCompact />);
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  expect(await screen.findByRole('textbox')).toHaveProperty('value', 'Unsent shell draft');
  expect(mockReady).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('opens the workspace and only populates a suggested task until Send is clicked', async () => {
  render(<AiChat />);
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review workspace templates' }));
  const input = screen.getByRole('textbox');
  expect(input).toHaveProperty('value', expect.stringContaining('Compare Foundation'));
  expect(mockSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.send' }));
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Retained conversation')).toBeTruthy();
});

it('closes with Escape and explicit Close, restores trigger focus and retains local prompt/runtime state', async () => {
  render(<AiChat />);
  const trigger = screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' });
  trigger.focus();
  fireEvent.click(trigger);
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value: 'My unsent prompt' } });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape', keyCode: 27 });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(await screen.findByRole('textbox')).toHaveProperty('value', 'My unsent prompt');
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(mockReady).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
});

it('retains the existing chat when workspace presentation is disabled', async () => {
  jest.replaceProperty(
    jest.requireMock<{ isDevFeaturesEnabled: boolean }>('@/consts/env'),
    'isDevFeaturesEnabled',
    false
  );
  render(<AiChat />);
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.queryByRole('complementary', { name: 'Ask AI tasks' })).toBeNull();
  expect(screen.getByRole('textbox')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
});

it('isolates the console from screen readers while the workspace is open', async () => {
  document.body.insertAdjacentHTML('beforeend', '<div id="app"></div>');
  const app = document.querySelector('#app')!;
  render(<AiChat />, { container: app });
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(app.getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
  await waitFor(() => {
    expect(app.getAttribute('aria-hidden')).toBeNull();
  });
});
