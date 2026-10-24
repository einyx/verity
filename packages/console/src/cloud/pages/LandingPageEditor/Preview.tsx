import { useEffect, useMemo, useRef, useState } from 'react';

import { isRecord } from './ContentEditor';
import styles from './index.module.scss';

// A simplified render of the draft section, so editors see the words in place as they type. It
// follows the content shape instead of the site's layout, so it shows the copy, not the exact design.

const headingKeys = new Set(['headline', 'heading', 'title', 'customer']);

const isLink = (value: unknown): value is { label: string; href: string } =>
  isRecord(value) && typeof value.label === 'string' && typeof value.href === 'string';

type EditProps = { readonly path: string; readonly onEdit: (path: string, value: string) => void };

type NodeProps = EditProps & {
  readonly name: string;
  readonly value: unknown;
};

/**
 * Text that is edited where it is shown. The text is set by hand, not through React's children, so the
 * caret stays put while typing; the draft is only written back to when the text changes.
 */
type EditableTextProps = EditProps & {
  readonly value: string;
  readonly className?: string;
};

function EditableText({ path, value, className, onEdit }: EditableTextProps) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // The text is written straight to the element, so typing is never interrupted by a re-render.
    if (ref.current && ref.current.textContent !== value) {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- a DOM property, not app state.
      ref.current.textContent = value;
    }
  }, [value]);

  return (
    <p
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className={className}
      onInput={(event) => {
        onEdit(path, event.currentTarget.textContent || '');
      }}
    />
  );
}

function PreviewNode({ name, value, path, onEdit }: NodeProps) {
  if (typeof value === 'string') {
    if (!value.trim()) {
      return null;
    }

    return (
      <EditableText
        path={path}
        value={value}
        className={headingKeys.has(name) ? styles.previewHeading : styles.previewText}
        onEdit={onEdit}
      />
    );
  }

  if (isLink(value)) {
    return <span className={styles.previewButton}>{value.label}</span>;
  }

  if (Array.isArray(value)) {
    return (
      <div className={styles.previewStack}>
        {value.map((item: unknown, index) => (
          <PreviewNode
            // eslint-disable-next-line react/no-array-index-key -- list items are static draft copy, so the index is stable
            key={`${name}-${index}`}
            name={name}
            value={item}
            path={`${path}.${index}`}
            onEdit={onEdit}
          />
        ))}
      </div>
    );
  }

  if (isRecord(value)) {
    // Consecutive links sit in one row, as the site lays out its button pairs.
    type Segment = { readonly isLinks: boolean; readonly items: Array<[string, unknown]> };
    const segments = Object.entries(value).reduce<Segment[]>((previous, [key, child]) => {
      const last = previous.at(-1);
      if (isLink(child) && last?.isLinks) {
        return [...previous.slice(0, -1), { isLinks: true, items: [...last.items, [key, child]] }];
      }
      return [...previous, { isLinks: isLink(child), items: [[key, child]] }];
    }, []);

    const rows = segments.map(({ isLinks, items }) => {
      const nodes = items.map(([key, child]) => (
        <PreviewNode key={key} name={key} value={child} path={`${path}.${key}`} onEdit={onEdit} />
      ));
      return isLinks ? (
        <div key={`actions-${items[0]?.[0]}`} className={styles.previewActions}>
          {nodes}
        </div>
      ) : (
        nodes
      );
    });

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
  /** Writes an edited field back to the draft, by its dotted path from the draft root. */
  readonly onEdit: (path: string, value: string) => void;
};

function Preview({ name, value, onSendChat, onEdit }: Props) {
  const isDemoChat = name === 'demoChat' && isRecord(value);

  return (
    <aside className={styles.preview} aria-label="Live preview">
      <div className={styles.previewLabel}>Live preview</div>
      {isDemoChat ? (
        <DemoChatPreview isEnabled={value.enabled === true} onSend={onSendChat} />
      ) : (
        <PreviewNode name={name} value={value} path={name} onEdit={onEdit} />
      )}
    </aside>
  );
}

// eslint-disable-next-line import/no-unused-modules
export default Preview;
