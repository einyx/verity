import { MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { type ChatMessage } from '@logto/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

import SessionConversation, { toSessionMessage } from './SessionConversation';
import Thread from './Thread';

// Markdown's ESM parser is unrelated to the real assistant runtime/send behavior under test.
jest.mock('@assistant-ui/react-markdown', () => ({ MarkdownTextPrimitive: () => null }));

const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
afterEach(() => {
  if (originalObserver) {
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Restore the test-owned layout shim only.
    Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
  } else {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
});

const message: ChatMessage = {
  id: 'stable-server-id',
  sequence: 1,
  turnId: 'turn',
  role: 'assistant',
  content: 'Only session one',
  createdAt: '2026-11-01T00:00:00.000Z',
  reviews: [],
};
const operations = {
  confirm: jest.fn(),
  cancel: jest.fn(),
  refresh: jest.fn(),
  refreshEditor: jest.fn(),
};
function Message() {
  return <MessagePrimitive.Content />;
}
const transcript = (
  <ThreadPrimitive.Root>
    <ThreadPrimitive.Messages components={{ Message }} />
  </ThreadPrimitive.Root>
);

it('rehydration_preserves_message_ids_and_review_chain', () => {
  const review = {
    originalActionId: 'original',
    currentActionId: 'replacement',
    tool: 'write',
    body: { exact: 'body' },
    expiresAt: '2026-11-01T00:30:00.000Z',
    state: 'executed' as const,
    isError: false,
  };
  const converted = toSessionMessage({ ...message, reviews: [review] });
  expect(converted.id).toBe('stable-server-id');
  expect(converted.metadata?.custom).toEqual({
    actions: [
      {
        id: 'original',
        tool: 'write',
        body: { exact: 'body' },
        expiresAt: review.expiresAt,
        status: 'done',
      },
    ],
  });
});

it('external runtime replaces server snapshots without duplicating or mixing session messages in strict mode', () => {
  const onSend = jest.fn();
  const view = render(
    <StrictMode>
      <SessionConversation
        isHydrated
        messages={[message]}
        isRunning={false}
        reviews={[]}
        operations={operations}
        onSend={onSend}
      >
        {transcript}
      </SessionConversation>
    </StrictMode>
  );
  expect(screen.getAllByText('Only session one')).toHaveLength(1);
  view.rerender(
    <SessionConversation
      key="two"
      isHydrated
      messages={[{ ...message, id: 'two', content: 'Only session two' }]}
      isRunning={false}
      reviews={[]}
      operations={operations}
      onSend={onSend}
    >
      {transcript}
    </SessionConversation>
  );
  expect(screen.queryByText('Only session one')).toBeNull();
  expect(screen.getAllByText('Only session two')).toHaveLength(1);
  expect(onSend).not.toHaveBeenCalled();
  expect(operations.confirm).not.toHaveBeenCalled();
});

it('offers a user-initiated CMS preview for ambiguous hero copy without generating or saving on hydration', async () => {
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- jsdom has no layout observer; the real assistant viewport requires its lifecycle API.
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {
        /* Jsdom has no viewport layout. */
      }

      unobserve() {
        /* No layout observer to release. */
      }

      disconnect() {
        /* No layout observer to release. */
      }
    },
  });
  const onSend = jest.fn();
  const view = render(
    <SessionConversation
      isHydrated
      messages={[
        {
          ...message,
          id: 'request',
          role: 'user',
          content: 'Generate a marketing hero for my bank call.',
        },
        { ...message, content: 'Headline: Govern your data with confidence.' },
      ]}
      isRunning={false}
      reviews={[]}
      operations={operations}
      onSend={onSend}
    >
      <Thread />
    </SessionConversation>
  );
  const preview = screen.getByRole('button', { name: 'Preview in CMS' });
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(preview);
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  expect(onSend).toHaveBeenCalledWith(
    'Show the previous marketing suggestion as an actual preview in the CMS editor. Do not save or publish.'
  );
  expect(operations.confirm).not.toHaveBeenCalled();
  for (const text of [
    'How does the landing page preview work?',
    'Generate landing page source code',
    'Do not generate a marketing hero',
  ]) {
    view.rerender(
      <SessionConversation
        isHydrated
        messages={[{ ...message, id: 'request', role: 'user', content: text }, message]}
        isRunning={false}
        reviews={[]}
        operations={operations}
        onSend={onSend}
      >
        <Thread />
      </SessionConversation>
    );
    expect(screen.queryByRole('button', { name: 'Preview in CMS' })).toBeNull();
  }
  view.rerender(
    <SessionConversation
      isHydrated
      isReadOnly
      messages={[
        { ...message, id: 'request', role: 'user', content: 'Generate a marketing hero' },
        message,
      ]}
      isRunning={false}
      reviews={[]}
      operations={operations}
      onSend={onSend}
    >
      <Thread />
    </SessionConversation>
  );
  expect(screen.queryByRole('button', { name: 'Preview in CMS' })).toBeNull();
  expect(onSend).toHaveBeenCalledTimes(1);
});
