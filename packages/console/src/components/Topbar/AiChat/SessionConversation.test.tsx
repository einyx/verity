import { MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { type ChatMessage } from '@logto/schemas';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';

import SessionConversation, { toSessionMessage } from './SessionConversation';

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
