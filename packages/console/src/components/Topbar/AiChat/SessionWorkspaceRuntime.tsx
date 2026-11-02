import { type ReactNode } from 'react';
import { useSWRConfig } from 'swr';

import { landingPageEditorKey } from '@/cloud/hooks/use-landing-page';

import SessionConversation from './SessionConversation';
import Thread from './Thread';
import { type SessionApi } from './session-api';
import { type SessionController } from './session-controller';
import { reviewAction } from './session-review';
import { type SessionRecord } from './session-state';

export default function SessionWorkspaceRuntime({
  controller,
  record,
  api,
  children,
}: {
  readonly controller: SessionController;
  readonly record: SessionRecord;
  readonly api: SessionApi;
  readonly children?: (thread: ReactNode) => ReactNode;
}) {
  const { mutate } = useSWRConfig();
  const { id } = record.session;
  return (
    <SessionConversation
      messages={record.messages}
      isRunning={record.running}
      reviews={record.reviews}
      isHydrated={record.hydrated}
      isReadOnly={Boolean(record.session.archivedAt) || Boolean(record.operation)}
      operations={{
        confirm: async (actionId) =>
          controller.reviewOperation(id, async () => api.confirm(actionId)),
        cancel: async (actionId) =>
          controller.reviewOperation(id, async () => api.cancel(actionId)),
        refresh: async (action) =>
          controller.reviewOperation(id, async () => {
            const original = record.reviews.find((review) => review.currentActionId === action.id);
            if (!original) {
              throw new Error('review_replaced');
            }
            return reviewAction(await api.refreshReview(id, original.originalActionId, action.id));
          }),
        refreshEditor: async () => mutate(landingPageEditorKey),
      }}
      onSend={async (text) => {
        await controller.send(text);
      }}
    >
      {children?.(<Thread />)}
    </SessionConversation>
  );
}
