/* eslint-disable max-lines -- The landing chat keeps its adapter, thread and composer together, so the widget reads as one file. */
// Demo chat for the static landing page. Built into `public/landing/demo-chat-app.js` by
// `vite.landing-chat.config.ts`. The model call and every limit run on the server in the landing page
// chat route, so this file only renders the conversation and forwards each visitor turn.
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const welcomeTitle = "Let's plan your demo";
const greeting = "Tell us who you are and what you'd like to see. We'll shape the demo around it.";
const fallbackError = 'Something went wrong on our side. You can also reach us at hello@meshx.io.';
// Matches the promise in the Request a demo steps: a reply from a solutions engineer within a business day.
const closedNotice =
  'Your request is in. A solutions engineer will reply within one business day, from a real person.';
const errorNotice =
  "We couldn't reach the assistant just now. Try again, or write to hello@meshx.io.";
// Matches the server's per-message limit in landing-page-chat-guard.ts.
const maxMessageLength = 1000;
const examplePlaceholder = 'Tell us about your team and one decision you want to improve…';
// One tap answers the first question: the visitor's interest, which the assistant then follows up on.
const quickReplies = [
  { prompt: 'Platform demo', tag: 'Overview', icon: 'grid' },
  { prompt: 'Foundation AI', tag: 'Product', icon: 'spark' },
  { prompt: 'Dashboards.AI', tag: 'Product', icon: 'chart' },
  { prompt: 'A specific use case', tag: 'Tailored', icon: 'target' },
] as const;

type IdeaIcon = (typeof quickReplies)[number]['icon'];

// Line icons drawn at 20px with the current text color, so they follow the row's color.
const iconPaths: Record<IdeaIcon, string> = {
  grid: 'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z',
  spark: 'M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.5 2.5M13 13l2.5 2.5M4.5 15.5 7 13M13 7l2.5-2.5',
  chart: 'M3 17h14M5 14V9M9 14V5M13 14v-3M17 14V7',
  target: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

function IdeaIconMark({ icon }: { readonly icon: IdeaIcon }) {
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
        <path d={iconPaths[icon]} />
      </svg>
    </span>
  );
}

const readError = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json();
    const message =
      typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;

    return typeof message === 'string' ? message : fallbackError;
  } catch {
    return fallbackError;
  }
};

const createAdapter = (
  sessionId: string,
  onStarted: () => void,
  onSubmitted: () => void,
  onOptions: (options: string[]) => void
): ChatModelAdapter => ({
  async run({ messages, abortSignal }) {
    onStarted();
    // The choices from the last reply are cleared once the visitor replies.
    onOptions([]);
    const last = messages.at(-1);
    const message = (last?.content ?? [])
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim();

    const response = await fetch('/api/landing-page/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sessionId, message }),
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const data: unknown = await response.json();
    const reply =
      typeof data === 'object' && data !== null && 'reply' in data && typeof data.reply === 'string'
        ? data.reply
        : fallbackError;

    if (
      typeof data === 'object' &&
      data !== null &&
      'submitted' in data &&
      data.submitted === true
    ) {
      onSubmitted();
    }

    // Quick-reply choices (contact method, yes or no) that the reply offers as buttons.
    const options =
      typeof data === 'object' && data !== null && 'options' in data && Array.isArray(data.options)
        ? data.options.filter((option): option is string => typeof option === 'string')
        : [];
    onOptions(options);

    return { content: [{ type: 'text', text: reply }] };
  },
});

function UserMessage() {
  return (
    <MessagePrimitive.Root className="demo-chat-message" data-role="user">
      <MessagePrimitive.Content />
    </MessagePrimitive.Root>
  );
}

// Links the assistant may show. The model can be steered by visitor text, so only our own HTTPS pages
// become links; anything else is shown as plain text.
const allowedLinkHosts = new Set(['meshx.io', 'www.meshx.io', 'docs.meshx.io']);

const isAllowedLink = (href: string | undefined): href is string => {
  if (!href) {
    return false;
  }

  try {
    const url = new URL(href);

    return url.protocol === 'https:' && allowedLinkHosts.has(url.hostname);
  } catch {
    return false;
  }
};

// Assistant replies use light Markdown (paragraphs, bold, short lists), rendered by assistant-ui.
function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="demo-chat-md"
      components={{
        a: ({ href, children }) =>
          isAllowedLink(href) ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          ),
      }}
    />
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="demo-chat-message" data-role="assistant">
      {/* Hiding the content until it has text keeps the library's placeholder dot out of the thread. */}
      <MessagePrimitive.If hasContent>
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      </MessagePrimitive.If>
      <MessagePrimitive.Error>
        <p className="demo-chat-error" role="alert">
          {errorNotice}
        </p>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

type BoundaryState = { readonly hasError: boolean };

// A render error in the chat must not leave the modal blank, so the visitor always has a way to reach us.
class ChatErrorBoundary extends Component<{ readonly children: ReactNode }, BoundaryState> {
  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  state: BoundaryState = { hasError: false };

  // eslint-disable-next-line @typescript-eslint/promise-function-async -- render() must return ReactNode (which the types widen to include Promise); React 18 does not render promises, so it cannot be async.
  render() {
    if (this.state.hasError) {
      return (
        <p className="demo-chat-status" role="alert">
          {fallbackError}
        </p>
      );
    }

    return this.props.children;
  }
}

// Status lines shown while the assistant replies. They cycle so the wait feels like progress.
const thinkingSteps = [
  'Thinking…',
  'Reading your message…',
  'Calculating your preferences…',
  'Finding the right meshX answer…',
];

function ThinkingStatus() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((current) => (current + 1) % thinkingSteps.length);
    }, 1800);

    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="demo-chat-thinking" role="status" aria-live="polite">
      <span className="demo-chat-thinking-dot" aria-hidden="true" />
      <span key={step} className="demo-chat-thinking-text">
        {thinkingSteps[step]}
      </span>
    </div>
  );
}

function DemoChat() {
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [submitted, setSubmitted] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  // The example placeholder only helps before the first message; afterwards a short prompt is enough.
  const [started, setStarted] = useState(false);
  const adapter = useMemo(
    () =>
      createAdapter(
        sessionId,
        () => {
          setStarted(true);
        },
        () => {
          setSubmitted(true);
        },
        setOptions
      ),
    [sessionId]
  );
  const runtime = useLocalRuntime(adapter);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The app mounts when the modal first opens, so the composer takes focus then. Later opens are
  // handled by the modal script, which focuses the composer again.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
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
                {welcomeTitle}
              </p>
              <p className="demo-chat-welcome-text">{greeting}</p>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <ThreadPrimitive.If running>
            <ThinkingStatus />
          </ThreadPrimitive.If>
        </ThreadPrimitive.Viewport>
        {!submitted && options.length > 0 && (
          <div
            className="demo-chat-options"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 16px 8px' }}
          >
            {options.map((option) => (
              <ThreadPrimitive.Suggestion
                key={option}
                send
                className="demo-chat-chip"
                prompt={option}
              >
                <span className="demo-chat-idea-label">{option}</span>
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        )}
        {submitted ? (
          <p className="demo-chat-status" role="status">
            {closedNotice}
          </p>
        ) : (
          <ComposerPrimitive.Root className="demo-chat-form">
            <ComposerPrimitive.Input
              ref={inputRef}
              className="demo-chat-input"
              aria-label="Your message"
              maxLength={maxMessageLength}
              placeholder={started ? 'Reply…' : examplePlaceholder}
              rows={1}
            />
            <div className="demo-chat-toolbar">
              <span className="demo-chat-hint">Enter to send</span>
              <ComposerPrimitive.Send className="demo-chat-send" aria-label="Send message">
                Send
              </ComposerPrimitive.Send>
            </div>
          </ComposerPrimitive.Root>
        )}
        <ThreadPrimitive.Empty>
          <div className="demo-chat-ideas">
            <p className="demo-chat-chips-label">Ideas for you</p>
            <div className="demo-chat-chips">
              {quickReplies.map(({ prompt, tag, icon }) => (
                <ThreadPrimitive.Suggestion
                  key={prompt}
                  send
                  className="demo-chat-chip"
                  prompt={prompt}
                >
                  <IdeaIconMark icon={icon} />
                  <span className="demo-chat-idea-label">{prompt}</span>
                  <span className="demo-chat-idea-tag">{tag}</span>
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </div>
        </ThreadPrimitive.Empty>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const mountPoint = document.querySelector('#demo-chat-root');

if (mountPoint) {
  createRoot(mountPoint).render(
    <ChatErrorBoundary>
      <DemoChat />
    </ChatErrorBoundary>
  );
}
/* eslint-enable max-lines */
