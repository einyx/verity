import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import PersistentAiChat from './PersistentAiChat';
import { type SessionApi } from './session-api';
import { fakeApi } from './session-controller.test-helper';

jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('@/consts/env', () => ({ isDevFeaturesEnabled: true }));
jest.mock('./SetupBanner', () => ({ __esModule: true, default: () => <p>Setup</p> }));
jest.mock('@/cloud/hooks/use-landing-page', () => ({ landingPageEditorKey: 'synthetic-editor' }));
jest.mock('@assistant-ui/react-markdown', () => ({ MarkdownTextPrimitive: () => <span /> }));
jest.mock('@/components/LandingChat/demo-chat.css', () => ({}));

const stamp = '2026-11-01T00:00:00.000Z';
it('opening never creates fake history; first edit persists once and navigation never approves', async () => {
  const session = {
    id: 'real',
    title: 'New chat',
    archivedAt: null,
    revision: 0,
    transcriptRevision: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const api = {
    ...fakeApi(),
    create: jest.fn(async () => session),
    get: jest.fn(async () => session),
    list: jest.fn(async () => ({ items: [], nextCursor: null })),
    saveComposer: jest.fn(async (_id: string, input: { text: string }) => ({
      text: input.text,
      attachments: [],
      revision: 1,
      updatedAt: stamp,
    })),
    confirm: jest.fn(),
    cancel: jest.fn(),
  } satisfies SessionApi;
  const app = document.createElement('div');
  app.setAttribute('id', 'app');
  document.body.append(app);
  render(<PersistentAiChat api={api} scope={{ tenantId: 'tenant', userId: 'owner' }} />, {
    container: app,
  });
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(api.create).not.toHaveBeenCalled();
  expect(screen.queryByRole('complementary')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
  expect(screen.getByRole('searchbox')).toBeTruthy();
  expect(api.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close history' }));
  expect(
    screen.getByRole('region', { name: 'Ask meshX conversation' }).getAttribute('aria-hidden')
  ).toBeNull();
  expect(screen.getByText(/saved to your account/)).toBeTruthy();
  fireEvent.change(
    screen.getByRole('textbox', { name: 'admin_console.inkeep_ai_bot.chat_placeholder' }),
    { target: { value: 'Private draft' } }
  );
  await waitFor(() => {
    expect(api.saveComposer).toHaveBeenCalledTimes(1);
  });
  expect(api.create).toHaveBeenCalledTimes(1);
  const composer = screen.getByRole('textbox', {
    name: 'admin_console.inkeep_ai_bot.chat_placeholder',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Rename…' }), {
    key: 'Escape',
    keyCode: 27,
  });
  expect(
    screen.getByRole('textbox', { name: 'admin_console.inkeep_ai_bot.chat_placeholder' })
  ).toBe(composer);
  expect(composer).toHaveProperty('value', 'Private draft');
  expect(api.saveComposer).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }));
  expect(api.confirm).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
});

it('identity changes clear private title searches and local workspace presentation', async () => {
  const api = {
    ...fakeApi(),
    list: jest.fn(async () => ({ items: [], nextCursor: null })),
  } satisfies SessionApi;
  const view = render(<PersistentAiChat api={api} scope={{ tenantId: 'tenant', userId: 'one' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  fireEvent.click(await screen.findByRole('button', { name: 'History' }));
  fireEvent.change(await screen.findByRole('searchbox'), {
    target: { value: 'Private account title' },
  });
  view.rerender(<PersistentAiChat api={api} scope={{ tenantId: 'tenant', userId: 'two' }} />);
  const open = screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' });
  if (!screen.queryByRole('dialog')) {
    fireEvent.click(open);
  }
  fireEvent.click(await screen.findByRole('button', { name: 'History' }));
  expect(await screen.findByRole('searchbox')).toHaveProperty('value', '');
});
