import { useState } from 'react';

import DraftChanges from './DraftChanges';
import styles from './index.module.scss';
import { documentsEqual } from './use-draft-session';

type Props = {
  readonly draft: unknown;
  readonly scope: string;
  readonly generateEdit: (instruction: string, draft: unknown) => Promise<unknown>;
  readonly onApply: (document: unknown) => void;
  readonly onClose: () => void;
  readonly isDisabled?: boolean;
};

function AiEditPanel({ draft, scope, generateEdit, onApply, onClose, isDisabled = false }: Props) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [proposal, setProposal] = useState<{ base: unknown; document: unknown }>();
  const stale = proposal !== undefined && !documentsEqual(proposal.base, draft);

  return (
    <section className={styles.aiPanel} aria-label="Edit draft with AI" aria-busy={busy}>
      <div className={styles.reviewHeading}>
        <div>
          <h2 className={styles.cardTitle}>Edit with AI</h2>
          <p className={styles.sectionHint}>
            Context: {scope}. Changes stay in your draft until published.
          </p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>
          Close AI editor
        </button>
      </div>
      <form
        className={styles.aiEdit}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || isDisabled || !instruction.trim()) {
            return;
          }
          const base = draft;
          setBusy(true);
          setError(undefined);
          setProposal(undefined);
          try {
            const document = await generateEdit(`Context: ${scope}. ${instruction.trim()}`, base);
            setProposal({ base, document });
          } catch (error_: unknown) {
            setError(error_ instanceof Error ? error_.message : 'AI edit failed. Try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="landing-page-ai-edit">Describe the change</label>
        <input
          id="landing-page-ai-edit"
          value={instruction}
          maxLength={2000}
          disabled={busy || isDisabled}
          placeholder="For example, shorten the hero introduction"
          onChange={(event) => {
            setInstruction(event.target.value);
          }}
        />
        <button
          type="submit"
          className={styles.secondaryButton}
          disabled={busy || isDisabled || !instruction.trim()}
        >
          {busy ? 'Generating…' : 'Review changes'}
        </button>
      </form>
      {busy && <p role="status">Preparing a suggestion. Your draft has not changed.</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {proposal && (
        <section aria-label="Review AI changes" className={styles.reviewPanel}>
          <h3 className={styles.cardTitle}>Review changes</h3>
          <p className={styles.sectionHint}>
            Apply these changes to your unsaved draft. Use Undo in the canvas to revert them.
          </p>
          <DraftChanges before={proposal.base} after={proposal.document} />
          {stale && (
            <p role="alert">
              Draft changed since this suggestion. Discard it and generate a new suggestion.
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={stale || isDisabled || documentsEqual(proposal.base, proposal.document)}
              onClick={() => {
                if (!documentsEqual(proposal.base, draft)) {
                  return;
                }
                onApply(proposal.document);
                setProposal(undefined);
              }}
            >
              Apply to draft
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                setProposal(undefined);
              }}
            >
              Discard
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

export default AiEditPanel;
