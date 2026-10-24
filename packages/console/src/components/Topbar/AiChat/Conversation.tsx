import {
  AssistantRuntimeProvider,
  useAui,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { createContext, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import useApi from '@/hooks/use-api';

import { type ProposedAction } from './ProposedActionCard';

type ChatResponse = {
  readonly content?: string;
  readonly actions?: Array<Omit<ProposedAction, 'status'>>;
};

type ActionStatus = Pick<ProposedAction, 'status' | 'message'>;

export type ConversationApi = {
  readonly send: (text: string) => void;
};

type ActionContextValue = {
  readonly statuses: Record<string, ActionStatus | undefined>;
  readonly onConfirm: (actionId: string) => void;
  readonly onCancel: (actionId: string) => void;
};

// Proposed actions ride on the assistant message's metadata, which is read-only. Their live status is
// kept here, so confirming or cancelling one doesn't rewrite the transcript.
export const ActionContext = createContext<ActionContextValue | undefined>(undefined);

/** Joins the text parts of a message. Non-text parts are not sent to the chat API. */
const textOf = (content: ReadonlyArray<{ readonly type: string }>) =>
  content
    .flatMap((part) => ('text' in part && typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
    .trim();

/** Hands the conversation's send function up to the modal, which owns the composer. */
function SendBridge({ onReady }: { readonly onReady: (api: ConversationApi) => void }) {
  const aui = useAui();

  useEffect(() => {
    onReady({
      send: (text) => {
        aui.thread().append({ role: 'user', content: [{ type: 'text', text }] });
      },
    });
  }, [aui, onReady]);

  return null;
}

type ConversationProps = {
  readonly children: ReactNode;
  readonly onReady: (api: ConversationApi) => void;
  readonly onRunStateChange: (isLoading: boolean) => void;
};

/**
 * One assistant-ui runtime for the whole session. It stays mounted outside the modal, so the
 * conversation survives closing the modal.
 */
function Conversation({ children, onReady, onRunStateChange }: ConversationProps) {
  const api = useApi();
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const [statuses, setStatuses] = useState<Record<string, ActionStatus | undefined>>({});

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async run({ messages, abortSignal }) {
        onRunStateChange(true);

        // No abort signal is passed to ky: the signal from the runtime fails ky's
        // `signal.addEventListener` call in the browser, which blocks every message.
        try {
          const response = await api
            .post('api/ai-chat/completions', {
              // Only role and content go to the server; proposed actions stay on the client.
              json: {
                // The server rejects empty content, and the runtime keeps placeholder messages
                // (for example an empty assistant turn) in the history, so drop them here.
                messages: messages
                  .map((message) => ({
                    role: message.role,
                    content: textOf(message.content),
                  }))
                  .filter(({ content }) => content.trim().length > 0),
              },
            })
            .json<ChatResponse>();

          const content = response.content ?? '';

          return {
            content: [{ type: 'text', text: content }],
            metadata: { custom: { actions: response.actions ?? [] } },
          };
        } finally {
          onRunStateChange(false);
        }
      },
    }),
    [api, onRunStateChange]
  );

  const runtime = useLocalRuntime(adapter);

  const actionContext = useMemo<ActionContextValue>(
    () => ({
      statuses,
      onConfirm: (actionId) => {
        setStatuses((current) => ({ ...current, [actionId]: { status: 'running' } }));
        void (async () => {
          try {
            await api.post(`api/ai-chat/actions/${actionId}/confirm`).json();
            setStatuses((current) => ({ ...current, [actionId]: { status: 'done' } }));
          } catch {
            setStatuses((current) => ({
              ...current,
              [actionId]: { status: 'failed', message: t('inkeep_ai_bot.action_failed_detail') },
            }));
          }
        })();
      },
      onCancel: (actionId) => {
        void (async () => {
          try {
            await api.post(`api/ai-chat/actions/${actionId}/cancel`).json();
          } catch {
            // If the cancel did not reach the server, the proposal expires on its own.
          }
          setStatuses((current) => ({ ...current, [actionId]: { status: 'cancelled' } }));
        })();
      },
    }),
    [api, statuses, t]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SendBridge onReady={onReady} />
      <ActionContext.Provider value={actionContext}>{children}</ActionContext.Provider>
    </AssistantRuntimeProvider>
  );
}

export default Conversation;
