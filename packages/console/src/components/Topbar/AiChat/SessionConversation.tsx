import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { type ChatMessage, type ChatReview } from '@logto/schemas';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionContext } from './ActionContext';
import { type ProposedAction } from './ProposedActionCard';
import { reviewAction } from './session-review';
import useChatActionReviews from './use-chat-action-reviews';

export const toSessionMessage = (message: ChatMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role,
  content: [{ type: 'text', text: message.content }],
  createdAt: new Date(message.createdAt),
  metadata: {
    custom: {
      actions: message.reviews.map((review) => ({
        ...reviewAction(review),
        id: review.originalActionId,
      })),
    },
  },
});

/** Read-only server history. onNew only captures a new explicit user intent, never hydration. */
export default function SessionConversation({
  messages,
  isRunning,
  reviews,
  isHydrated,
  isReadOnly = false,
  onSend,
  operations,
  children,
}: {
  readonly messages: ChatMessage[];
  readonly isRunning: boolean;
  readonly reviews: ChatReview[];
  readonly isHydrated: boolean;
  readonly isReadOnly?: boolean;
  readonly onSend: (text: string) => Promise<void>;
  readonly operations: {
    confirm: (id: string) => Promise<unknown>;
    cancel: (id: string) => Promise<unknown>;
    refresh: (action: ProposedAction) => Promise<ProposedAction>;
    refreshEditor: () => Promise<unknown>;
  };
  readonly children?: ReactNode;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const actions = useChatActionReviews({
    ...operations,
    reviews,
    hydrated: isHydrated,
    disabled: isReadOnly,
    failureMessage: t('inkeep_ai_bot.action_failed_detail'),
  });
  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages,
    isRunning,
    isDisabled: !isHydrated || isReadOnly,
    convertMessage: toSessionMessage,
    onNew: async (message) => {
      const text = message.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join('\n');
      await onSend(text);
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ActionContext.Provider value={actions}>{children}</ActionContext.Provider>
    </AssistantRuntimeProvider>
  );
}
