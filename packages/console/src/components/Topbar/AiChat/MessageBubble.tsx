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
 * One turn of the transcript, styled like the landing page chat: the user's message is a light
 * bubble on the right, and the assistant's reply is Markdown on the open surface.
 */
function MessageBubble({ sender, content }: Props) {
  if (sender === 'user') {
    return (
      <div className={styles.demoUserTurn}>
        <div className={styles.demoUserBubble}>{content}</div>
      </div>
    );
  }

  return (
    <div className={styles.demoAssistantTurn}>
      <div className={styles.demoMarkdown}>
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
