import {
  AssistantRuntimeProvider,
  useAui,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';

import { landingPageEditorKey } from '@/cloud/hooks/use-landing-page';
import useApi from '@/hooks/use-api';

import { ActionContext } from './ActionContext';
import { type ProposedAction } from './ProposedActionCard';
import { refreshDraftReview } from './refresh-draft-review';
import useChatActionReviews from './use-chat-action-reviews';
import useLandingPageAiHeaders from './use-landing-page-ai-headers';

type ChatResponse = {
  readonly content?: string;
  readonly actions?: Array<Omit<ProposedAction, 'status'>>;
};

export type ConversationApi = {
  readonly send: (text: string) => void;
};

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
  const landingPageAiHeaders = useLandingPageAiHeaders();
  const { mutate } = useSWRConfig();
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const actionContext = useChatActionReviews({
    confirm: async (id) =>
      api
        .post(`api/ai-chat/actions/${id}/confirm`, {
          headers: await landingPageAiHeaders(),
        })
        .json(),
    cancel: async (id) => api.post(`api/ai-chat/actions/${id}/cancel`).json(),
    refresh: async (action) =>
      refreshDraftReview(action, async (request) =>
        api
          .post('api/ai-chat/actions', {
            json: request,
            headers: await landingPageAiHeaders(),
          })
          .json()
      ),
    refreshEditor: async () => mutate(landingPageEditorKey),
    failureMessage: t('inkeep_ai_bot.action_failed_detail'),
  });

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async run({ messages, abortSignal }) {
        onRunStateChange(true);

        // No abort signal is passed to ky: the signal from the runtime fails ky's
        // `signal.addEventListener` call in the browser, which blocks every message.
        try {
          const response = await api
            .post('api/ai-chat/completions', {
              // Tool-backed reviews can outlive the ordinary 20s management request budget.
              // Bound this request only; confirmations and other writes keep their defaults.
              timeout: 180_000,
              headers: await landingPageAiHeaders(),
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
    [api, landingPageAiHeaders, onRunStateChange]
  );

  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SendBridge onReady={onReady} />
      <ActionContext.Provider value={actionContext}>{children}</ActionContext.Provider>
    </AssistantRuntimeProvider>
  );
}

export default Conversation;
