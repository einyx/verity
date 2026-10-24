import { type LandingLeadTranscript } from '@/cloud/hooks/use-landing-leads';

import styles from './Transcript.module.scss';

export type TranscriptProps = {
  readonly messages?: LandingLeadTranscript;
  readonly isFailed: boolean;
};

function Transcript({ messages, isFailed }: TranscriptProps) {
  if (isFailed) {
    return <p className={styles.notice}>The conversation could not be loaded.</p>;
  }

  if (!messages) {
    return <p className={styles.muted}>Loading conversation…</p>;
  }

  if (messages.length === 0) {
    return <p className={styles.muted}>This conversation has no messages.</p>;
  }

  return (
    <div className={styles.messages}>
      {messages.map((message, index) => (
        <div
          // The transcript is read-only and never reordered, so the position is a stable key.
          // eslint-disable-next-line react/no-array-index-key -- Read-only messages are never reordered.
          key={index}
          className={message.role === 'user' ? styles.messageVisitor : styles.messageAssistant}
        >
          <span className={styles.messageRole}>
            {message.role === 'user' ? 'Visitor' : 'Assistant'}
          </span>
          <span>{message.content}</span>
        </div>
      ))}
    </div>
  );
}

export default Transcript;
