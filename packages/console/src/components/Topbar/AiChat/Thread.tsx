import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionContext } from './Conversation';
import MessageBubble from './MessageBubble';
import ProposedActionCard, { type ProposedAction } from './ProposedActionCard';
import styles from './index.module.scss';

// Metadata comes from the chat response, so each entry is checked before it is rendered as an action.
const isActionList = (value: unknown): value is Array<Omit<ProposedAction, 'status'>> =>
  Array.isArray(value) &&
  value.every(
    (item: unknown) =>
      typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string'
  );

function UserText({ text }: { readonly text: string }) {
  return <MessageBubble sender="user" content={text} />;
}

function AssistantText({ text }: { readonly text: string }) {
  return <MessageBubble sender="assistant" content={text} />;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Content components={{ Text: UserText }} />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const actionContext = useContext(ActionContext);
  const custom = useAuiState((state) => state.message.metadata.custom);
  const actions = isActionList(custom.actions) ? custom.actions : [];

  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Content components={{ Text: AssistantText }} />
      {actions.map((action) => (
        <ProposedActionCard
          key={action.id}
          action={{
            ...action,
            status: 'pending',
            ...actionContext?.statuses[action.id],
          }}
          onConfirm={() => {
            actionContext?.onConfirm(action.id);
          }}
          onCancel={() => {
            actionContext?.onCancel(action.id);
          }}
        />
      ))}
      <MessagePrimitive.Error>
        <div className={styles.error}>{t('inkeep_ai_bot.unavailable')}</div>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

/** The transcript: the intro line, then every turn of the conversation. */
function Thread() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });

  return (
    <ThreadPrimitive.Root>
      <ThreadPrimitive.Viewport className={styles.messages}>
        <MessageBubble sender="assistant" content={t('inkeep_ai_bot.intro_message')} />
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

export default Thread;
