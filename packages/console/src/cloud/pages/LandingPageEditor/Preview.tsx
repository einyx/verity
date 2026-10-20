import { type ReactNode, useMemo, useState } from 'react';

import { isRecord } from './ContentEditor';
import styles from './index.module.scss';

// A simplified render of the draft section, so editors see the words in place as they type. It
// follows the content shape instead of the site's layout, so it shows the copy, not the exact design.

const headingKeys = new Set(['headline', 'heading', 'title', 'customer']);

const isLink = (value: unknown): value is { label: string; href: string } =>
  isRecord(value) && typeof value.label === 'string' && typeof value.href === 'string';

type NodeProps = {
  readonly name: string;
  readonly value: unknown;
};

function PreviewNode({ name, value }: NodeProps) {
  if (typeof value === 'string') {
    if (!value.trim()) {
      return null;
    }

    return headingKeys.has(name) ? (
      <p className={styles.previewHeading}>{value}</p>
    ) : (
      <p className={styles.previewText}>{value}</p>
    );
  }

  if (isLink(value)) {
    return <span className={styles.previewButton}>{value.label}</span>;
  }

  if (Array.isArray(value)) {
    return (
      <div className={styles.previewStack}>
        {value.map((item: unknown, index) => (
          <PreviewNode key={`${name}-${index}`} name={name} value={item} />
        ))}
      </div>
    );
  }

  if (isRecord(value)) {
    // Consecutive links sit in one row, as the site lays out its button pairs.
    const rows: ReactNode[] = [];
    let links: ReactNode[] = [];
    const flush = () => {
      if (links.length > 0) {
        rows.push(
          <div key={`actions-${rows.length}`} className={styles.previewActions}>
            {links}
          </div>
        );
        links = [];
      }
    };

    for (const [key, child] of Object.entries(value)) {
      if (isLink(child)) {
        links.push(<PreviewNode key={key} name={key} value={child} />);
      } else {
        flush();
        rows.push(<PreviewNode key={key} name={key} value={child} />);
      }
    }
    flush();

    return <div className={styles.previewStack}>{rows}</div>;
  }

  return null;
}

type ChatMessage = { readonly role: 'user' | 'assistant'; readonly text: string };

// The demo chat as a visitor sees it. Messages go to the real chat API, so the replies are the live AI's.
function DemoChatPreview({
  isEnabled,
  onSend,
}: {
  readonly isEnabled: boolean;
  readonly onSend: (sessionId: string, message: string) => Promise<{ reply: string }>;
}) {
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string>();

  if (!isEnabled) {
    return (
      <div className={styles.chatMock}>
        <div className={styles.chatBubbleMuted}>The static request form shows on the site.</div>
      </div>
    );
  }

  const send = async () => {
    const text = input.trim();
    if (!text || sending) {
      return;
    }

    setSending(true);
    setChatError(undefined);
    setMessages((previous) => [...previous, { role: 'user', text }]);
    setInput('');

    try {
      const { reply } = await onSend(sessionId, text);
      setMessages((previous) => [...previous, { role: 'assistant', text: reply }]);
    } catch (error: unknown) {
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.chatMock} aria-label="Demo chat preview">
      {messages.length === 0 && (
        <div className={styles.chatBubbleAssistant}>
          Ask a question about how meshX works for your industry.
        </div>
      )}
      {messages.map((message, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key -- messages only append, so the index is a stable key
          key={index}
          className={message.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant}
        >
          {message.text}
        </div>
      ))}
      {sending && <div className={styles.chatBubbleMuted}>Thinking…</div>}
      {chatError && (
        <p role="alert" className={styles.error}>
          {chatError}
        </p>
      )}
      <form
        className={styles.chatInput}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          className={styles.chatField}
          value={input}
          placeholder="Ask a question…"
          aria-label="Message"
          onChange={(event) => {
            setInput(event.target.value);
          }}
        />
        <button
          type="submit"
          className={styles.chatSend}
          disabled={sending || !input.trim()}
          aria-label="Send"
        >
          ↑
        </button>
      </form>
      <div className={styles.hint}>
        Sends to the live chat. Messages and any lead you share are real.
      </div>
    </div>
  );
}

type Props = {
  readonly name: string;
  readonly value: unknown;
  readonly onSendChat: (sessionId: string, message: string) => Promise<{ reply: string }>;
};

function LivePreview({ name, value, onSendChat }: Props) {
  const isDemoChat = name === 'demoChat' && isRecord(value);

  return (
    <aside className={styles.preview} aria-label="Live preview">
      <div className={styles.previewLabel}>Live preview</div>
      {isDemoChat ? (
        <DemoChatPreview isEnabled={value.enabled === true} onSend={onSendChat} />
      ) : (
        <PreviewNode name={name} value={value} />
      )}
    </aside>
  );
}

export default LivePreview;
