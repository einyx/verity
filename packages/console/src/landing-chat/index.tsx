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
import { demoChatByLocale, demoChatEn } from '@logto/phrases';
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { readWithin, renderTurnstile } from './turnstile';

// Copy comes from @logto/phrases. The visitor's browser language picks the locale; any key a locale
// lacks falls back to English.

const findLocale = () => {
  const preferred = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  const locales = Object.keys(demoChatByLocale);

  for (const tag of preferred) {
    const match = locales.find((locale) => locale.toLowerCase() === tag.toLowerCase());

    if (match) {
      return match;
    }
  }

  for (const tag of preferred) {
    const language = tag.toLowerCase().split('-')[0];
    const match = locales.find((locale) => locale.toLowerCase().split('-')[0] === language);

    if (match) {
      return match;
    }
  }

  return 'en';
};

// The English copy is the base, so a key a locale lacks still has text.
const copy: typeof demoChatEn = { ...demoChatEn, ...demoChatByLocale[findLocale()] };

const {
  welcome_title: welcomeTitle,
  greeting,
  fallback_error: fallbackError,
  // Matches the promise in the Request a demo steps: a reply from a solutions engineer within a business day.
  closed_notice: closedNotice,
  // Shown only when the request never reached the server; once it does, the server saves the message and answers.
  error_notice: errorNotice,
  example_placeholder: examplePlaceholder,
  quick_platform_demo: quickPlatformDemo,
  quick_foundation_ai: quickFoundationAi,
  quick_dashboards: quickDashboards,
  quick_use_case: quickUseCase,
  industry_aviation: industryAviation,
  industry_banking: industryBanking,
  industry_healthcare: industryHealthcare,
  industry_smart_city: industrySmartCity,
  quick_industry_aviation: quickIndustryAviation,
  quick_industry_banking: quickIndustryBanking,
  quick_industry_healthcare: quickIndustryHealthcare,
  quick_industry_smart_city: quickIndustrySmartCity,
} = copy;

// Matches the server's per-message limit in landing-page-chat-guard.ts.
const maxMessageLength = 1000;
// One tap answers the first question: the visitor's interest, which the assistant then follows up on.
// The industry rows name the sector and fill the composer with its question, so the visitor can
// adjust it before sending.
const quickReplies = [
  { label: quickPlatformDemo, prompt: quickPlatformDemo, tag: 'Overview', icon: 'grid', send: true },
  { label: quickFoundationAi, prompt: quickFoundationAi, tag: 'Product', icon: 'spark', send: true },
  { label: quickDashboards, prompt: quickDashboards, tag: 'Product', icon: 'chart', send: true },
  { label: quickUseCase, prompt: quickUseCase, tag: 'Tailored', icon: 'target', send: true },
  {
    label: industryAviation,
    prompt: quickIndustryAviation,
    tag: 'Industry',
    icon: 'plane',
    send: false,
  },
  { label: industryBanking, prompt: quickIndustryBanking, tag: 'Industry', icon: 'bank', send: false },
  {
    label: industryHealthcare,
    prompt: quickIndustryHealthcare,
    tag: 'Industry',
    icon: 'health',
    send: false,
  },
  { label: industrySmartCity, prompt: quickIndustrySmartCity, tag: 'Industry', icon: 'city', send: false },
] as const;

type IdeaIcon = (typeof quickReplies)[number]['icon'];

// Line icons drawn at 20px with the current text color, so they follow the row's color.
const iconPaths: Record<IdeaIcon, string> = {
  grid: 'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z',
  spark: 'M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.5 2.5M13 13l2.5 2.5M4.5 15.5 7 13M13 7l2.5-2.5',
  chart: 'M3 17h14M5 14V9M9 14V5M13 14v-3M17 14V7',
  target: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  plane: 'M2 9.5 18 3l-6.5 14-2.5-6z',
  bank: 'M2 8l8-5 8 5M4 9v6M8 9v6M12 9v6M16 9v6M3 17h14',
  health: 'M8 3h4v5h5v4h-5v5H8v-5H3V8h5z',
  city: 'M4 17V8l4-3v12M8 17V3l6 3v11M14 17V9l3-2v10M2 17h16',
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

// Shown when the visitor has sent too many messages in a short time, so they know to wait instead of retrying.
const rateLimitedNotice =
  "You've sent a lot of messages in a short time. Please wait a few minutes and try again.";

const readError = async (response: Response): Promise<string> => {
  if (response.status === 429) {
    return rateLimitedNotice;
  }

  try {
    const body: unknown = await response.json();
    const message =
      typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;

    return typeof message === 'string' ? message : fallbackError;
  } catch {
    return fallbackError;
  }
};

/** How long a send waits for the widget to produce a token before it goes without one. */
const turnstileWaitMs = 5000;

/** The Turnstile token for the next new session. A token is used once, so it is taken and cleared here. */
type TurnstileSource = {
  take: () => Promise<string | undefined>;
  renew: () => void;
};

const createAdapter = (
  sessionId: string,
  onStarted: () => void,
  onSubmitted: () => void,
  onOptions: (options: string[]) => void,
  turnstile: TurnstileSource
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

    // The token is only checked when the session is new. Taking it and renewing the widget now means the
    // next message already has a fresh token, whatever the outcome of this request.
    const turnstileToken = await turnstile.take();
    turnstile.renew();

    const response = await fetch('/api/landing-page/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sessionId,
        message,
        locale: navigator.language,
        turnstileToken,
      }),
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
  // Turnstile: the widget keeps one fresh token ready. The site key comes from the server; without one,
  // no widget is drawn and no token is sent.
  const widgetRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<string | undefined>(undefined);
  const renewRef = useRef<(() => void) | undefined>(undefined);
  // Set once a widget is being drawn, so a send knows whether it should wait for a token.
  const drawnRef = useRef(false);
  const [siteKey, setSiteKey] = useState<string | undefined>(undefined);
  const turnstile = useMemo<TurnstileSource>(
    () => ({
      take: async () => {
        // Without a widget there is no token to wait for.
        if (!drawnRef.current) {
          return;
        }

        // The widget may still be solving when the visitor sends, so wait for a token for a short time.
        const token = await readWithin(() => tokenRef.current, turnstileWaitMs);
        // eslint-disable-next-line @silverhand/fp/no-mutation -- the ref holds the widget's current token, which is single-use
        tokenRef.current = undefined;

        return token;
      },
      renew: () => {
        renewRef.current?.();
      },
    }),
    []
  );
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
        setOptions,
        turnstile
      ),
    [sessionId, turnstile]
  );
  const runtime = useLocalRuntime(adapter);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The app mounts when the modal first opens, so the composer takes focus then. Later opens are
  // handled by the modal script, which focuses the composer again.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reads the public Turnstile site key. A failed read leaves the chat without a widget.
  useEffect(() => {
    const loadSiteKey = async () => {
      try {
        const response = await fetch('/api/landing-page/chat/config', {
          headers: { accept: 'application/json' },
        });
        const data: unknown = response.ok ? await response.json() : undefined;
        const key =
          typeof data === 'object' &&
          data !== null &&
          'turnstileSiteKey' in data &&
          typeof data.turnstileSiteKey === 'string'
            ? data.turnstileSiteKey
            : '';
        setSiteKey(key === '' ? undefined : key);
      } catch {
        setSiteKey(undefined);
      }
    };

    void loadSiteKey();
  }, []);

  useEffect(() => {
    const container = widgetRef.current;

    if (!siteKey || !container) {
      return;
    }

    // eslint-disable-next-line @silverhand/fp/no-mutation -- the ref records that a widget is being drawn
    drawnRef.current = true;

    const draw = async () => {
      try {
        const renew = await renderTurnstile(container, siteKey, (token) => {
          // eslint-disable-next-line @silverhand/fp/no-mutation -- the ref holds the widget's latest token, replaced on each callback
          tokenRef.current = token;
        });
        // eslint-disable-next-line @silverhand/fp/no-mutation -- the ref holds the widget's reset function, set once it is drawn
        renewRef.current = renew;
      } catch {
        // Without a widget the chat sends no token, and the server refuses new sessions.
        // eslint-disable-next-line @silverhand/fp/no-mutation -- the ref is cleared when the widget fails
        tokenRef.current = undefined;
      }
    };

    void draw();
  }, [siteKey]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="demo-chat-thread">
        <div ref={widgetRef} className="demo-chat-turnstile" />
        <ThreadPrimitive.Viewport className="demo-chat-log">
          <ThreadPrimitive.Empty>
            <div className="demo-chat-welcome">
              <p className="demo-chat-welcome-title">
                <svg
                  className="demo-chat-mark"
                  aria-hidden="true"
                  viewBox="-1 17 84 92"
                  fill="#FE330A"
                >
                  {/* The meshX logo mark, taken from meshx-logo.svg. The view box holds the whole
                      mark with a unit of room around it, so nothing is cut off. */}
                  <path d="M82 37V19L41 45 0 18v19l27 17 14 9 14-9zM82 89v18L41 81 0 108V89l27-17 14-9 14 9z" />
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
              {quickReplies.map(({ label, prompt, tag, icon, send }) => (
                <ThreadPrimitive.Suggestion
                  key={prompt}
                  send={send}
                  className="demo-chat-chip"
                  prompt={prompt}
                >
                  <IdeaIconMark icon={icon} />
                  <span className="demo-chat-idea-label">{label}</span>
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
