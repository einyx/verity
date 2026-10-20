import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionContext } from './Conversation';
import ProposedActionCard, { type ProposedAction } from './ProposedActionCard';

// Metadata comes from the chat response, so each entry is checked before it is rendered as an action.
const isActionList = (value: unknown): value is Array<Omit<ProposedAction, 'status'>> =>
  Array.isArray(value) &&
  value.every(
    (item: unknown) =>
      typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string'
  );

// Line icons from the landing page demo chat, drawn at 20px with the current text color.
const ideaIconPaths = [
  'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z',
  'M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.5 2.5M13 13l2.5 2.5M4.5 15.5 7 13M13 7l2.5-2.5',
  'M3 17h14M5 14V9M9 14V5M13 14v-3M17 14V7',
  'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
];

function IdeaIconMark({ index }: { readonly index: number }) {
  return (
    <span className="demo-chat-idea-icon" aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ideaIconPaths[index % ideaIconPaths.length] ?? ''} />
      </svg>
    </span>
  );
}

// Assistant replies use light Markdown, rendered by assistant-ui, as on the landing page.
function MarkdownText() {
  return <MarkdownTextPrimitive className="demo-chat-md" />;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="demo-chat-message" data-role="user">
      <MessagePrimitive.Content />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const actionContext = useContext(ActionContext);
  const custom = useAuiState((state) => state.message.metadata.custom);
  const actions = isActionList(custom.actions) ? custom.actions : [];

  return (
    <MessagePrimitive.Root className="demo-chat-message" data-role="assistant">
      {/* Hiding the content until it has text keeps the library's placeholder dot out of the thread. */}
      <MessagePrimitive.If hasContent>
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      </MessagePrimitive.If>
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
        <p className="demo-chat-error" role="alert">
          {t('inkeep_ai_bot.unavailable')}
        </p>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

// Status lines shown while the assistant replies. They cycle so the wait feels like progress.
function ThinkingStatus() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const steps = t('inkeep_ai_bot.thinking_steps', { returnObjects: true });
  const [step, setStep] = useState(0);
  const count = Array.isArray(steps) ? steps.length : 0;

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((current) => (count ? (current + 1) % count : 0));
    }, 1800);

    return () => {
      clearInterval(timer);
    };
  }, [count]);

  return (
    <div className="demo-chat-thinking" role="status" aria-live="polite">
      <span className="demo-chat-thinking-dot" aria-hidden="true" />
      <span key={step} className="demo-chat-thinking-text">
        {Array.isArray(steps) ? steps[step] : undefined}
      </span>
    </div>
  );
}

/**
 * The transcript, laid out as on the landing page demo chat: a centred welcome before the first
 * message, the example questions as idea rows, then the conversation with the typing dots while a
 * reply runs.
 */
function Thread() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const questions = t('inkeep_ai_bot.example_questions', { returnObjects: true });

  return (
    <ThreadPrimitive.Root className="demo-chat-thread">
      <ThreadPrimitive.Viewport className="demo-chat-log">
        <ThreadPrimitive.Empty>
          <div className="demo-chat-welcome">
            <p className="demo-chat-welcome-title">
              <svg className="demo-chat-mark" aria-hidden="true" viewBox="0 0 24 24" fill="none">
                {/* The meshX logo mark: two crossing strokes in the brand red. */}
                <path
                  d="M5 5l14 14M19 5L5 19"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
              </svg>
              {t('inkeep_ai_bot.ask_ai_label')}
            </p>
            <p className="demo-chat-welcome-text">{t('inkeep_ai_bot.intro_message')}</p>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <ThreadPrimitive.If running>
          <ThinkingStatus />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>
      <ThreadPrimitive.Empty>
        {Array.isArray(questions) && (
          <div className="demo-chat-ideas">
            <p className="demo-chat-chips-label">{t('inkeep_ai_bot.example_questions_label')}</p>
            <div className="demo-chat-chips">
              {questions.map((question, index) => (
                <ThreadPrimitive.Suggestion
                  key={question}
                  send
                  className="demo-chat-chip"
                  prompt={question}
                >
                  <IdeaIconMark index={index} />
                  <span className="demo-chat-idea-label">{question}</span>
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </div>
        )}
      </ThreadPrimitive.Empty>
    </ThreadPrimitive.Root>
  );
}

export default Thread;
