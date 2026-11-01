import { nanoid } from 'nanoid';
import { useEffect, useRef, useState } from 'react';

import {
  type LandingLeadEmailDraft,
  type LandingLeadEmailAcceptance,
} from '@/cloud/hooks/use-landing-leads';

import styles from './FollowUpEmailReview.module.scss';
import {
  formatFollowUpDraft,
  followUpParagraphs,
  hasUnfinishedSignature,
} from './follow-up-format';

export default function FollowUpEmailReview({
  recipient,
  initialText,
  onSend,
  onClose,
}: {
  readonly recipient: string;
  readonly initialText: string;
  readonly onSend: (draft: LandingLeadEmailDraft) => Promise<LandingLeadEmailAcceptance>;
  readonly onClose: () => void;
}) {
  const [subject, setSubject] = useState('Following up on your MeshX demo request');
  const [text, setText] = useState(() => formatFollowUpDraft(initialText));
  const [phase, setPhase] = useState<'compose' | 'review' | 'sending' | 'accepted' | 'unknown'>(
    'compose'
  );
  const idempotencyKey = useRef(nanoid(32)).current;
  const inFlight = useRef(false);
  const alive = useRef(true);
  const subjectRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    subjectRef.current?.focus();
    return () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- An abandoned lead visit must not receive a stale send result.
      alive.current = false;
    };
  }, []);
  const placeholders = hasUnfinishedSignature(text);
  const valid =
    subject.trim().length > 0 &&
    subject.length <= 200 &&
    !/[\n\r]/.test(subject) &&
    text.trim().length > 0 &&
    text.length <= 8000 &&
    !placeholders;
  const send = async () => {
    if (phase !== 'review' || inFlight.current || !valid) {
      return;
    }
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Close the same-tick double-click window before the disabled state renders.
    inFlight.current = true;
    setPhase('sending');
    try {
      await onSend({
        subject: subject.trim(),
        text: text.trim(),
        confirmed: true,
        idempotencyKey,
      });
      if (alive.current) {
        setPhase('accepted');
      }
    } catch {
      if (alive.current) {
        setPhase('unknown');
      }
    }
  };
  return (
    <section className={styles.composer} aria-label="Lead follow-up email">
      <h3>{phase === 'compose' ? 'Compose follow-up email' : 'Review follow-up email'}</h3>
      <label className={styles.field}>
        Recipient
        <input readOnly value={recipient} type="email" />
      </label>
      <p className={styles.note}>
        Sends through the configured MeshX email service to this saved lead. No files are attached.
      </p>
      {phase === 'compose' ? (
        <>
          <label className={styles.field}>
            Subject
            <input
              ref={subjectRef}
              value={subject}
              maxLength={200}
              onChange={(event) => {
                setSubject(event.target.value);
              }}
            />
          </label>
          <label className={styles.field}>
            Message
            <textarea
              rows={10}
              value={text}
              maxLength={8000}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
          {placeholders && <p role="alert">Replace the sender placeholders before sending.</p>}
        </>
      ) : (
        <>
          <p className={styles.subject}>{subject}</p>
          <div className={styles.messagePreview}>
            {followUpParagraphs(text).map((paragraph, index) => (
              // eslint-disable-next-line react/no-array-index-key -- These static plain-text paragraphs have no per-item state and may intentionally repeat.
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </>
      )}
      {phase === 'accepted' && (
        <p role="status">Submitted to the email service. This does not confirm delivery.</p>
      )}
      {phase === 'unknown' && (
        <p role="alert">
          Email submission could not be verified. Check before sending another email. This request
          will not be retried automatically.
        </p>
      )}
      <div className={styles.buttons}>
        {phase === 'compose' && (
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              setPhase('review');
            }}
          >
            Review email
          </button>
        )}
        {phase === 'review' && (
          <>
            <button
              type="button"
              onClick={() => {
                setPhase('compose');
              }}
            >
              Edit email
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                void send();
              }}
            >
              Send email
            </button>
          </>
        )}
        {phase === 'sending' && <p role="status">Submitting email…</p>}
        <button type="button" disabled={phase === 'sending'} onClick={onClose}>
          {phase === 'accepted' || phase === 'unknown' ? 'Close' : 'Cancel'}
        </button>
      </div>
    </section>
  );
}
