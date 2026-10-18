import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Without this, the markdown renderer can crash in the parcel dev build. See components/Markdown.
// eslint-disable-next-line import/no-unassigned-import -- Side-effect import works around a parcel dev-build crash.
import 'property-information';

import styles from './index.module.scss';

type Props = {
  readonly sender: 'user' | 'assistant';
  readonly content: string;
};

/**
 * One turn of the transcript, styled like a coding agent's session: the user's message follows a
 * prompt marker, and the assistant's reply is plain output with a dot marker. Neither is a bubble.
 */
function MessageBubble({ sender, content }: Props) {
  if (sender === 'user') {
    return (
      <div className={styles.userTurn}>
        <span aria-hidden className={styles.promptMark}>
          ›
        </span>
        <div className={styles.userText}>{content}</div>
      </div>
    );
  }

  return (
    <div className={styles.assistantTurn}>
      <span aria-hidden className={styles.assistantMark}>
        ●
      </span>
      <div className={styles.markdown}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export default MessageBubble;
