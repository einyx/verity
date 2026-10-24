import { useTranslation } from 'react-i18next';

import styles from './index.module.scss';

/** A write the assistant proposed. It only runs when the user confirms it here. */
export type ProposedAction = {
  readonly id: string;
  readonly tool: string;
  readonly body: Record<string, unknown>;
  readonly expiresAt: string;
  readonly status: 'pending' | 'running' | 'done' | 'cancelled' | 'failed';
  readonly message?: string;
};

type Props = {
  readonly action: ProposedAction;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

const formatValue = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/**
 * Shows a proposed write the way a coding agent shows an edit: each field of the request is a
 * `+` line, and Allow / Reject sit under it while the write is pending.
 */
function ProposedActionCard({ action, onConfirm, onCancel }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });

  const statusLabel = {
    running: t('inkeep_ai_bot.action_running'),
    done: t('inkeep_ai_bot.action_done'),
    cancelled: t('inkeep_ai_bot.action_cancelled'),
    failed: t('inkeep_ai_bot.action_failed'),
  };

  const fields = Object.entries(action.body).filter(([, value]) => value !== undefined);

  return (
    <div className={styles.actionCard}>
      <div className={styles.actionHeader}>
        <span className={styles.actionTitle}>
          {t('inkeep_ai_bot.action_proposed', { tool: action.tool })}
        </span>
        {action.status !== 'pending' && (
          <span className={styles.actionStatus}>{statusLabel[action.status]}</span>
        )}
      </div>
      <div className={styles.diff} role="list">
        {fields.map(([key, value]) => (
          <div key={key} className={styles.diffLine} role="listitem">
            <span aria-hidden className={styles.diffSign}>
              +
            </span>
            <span className={styles.diffKey}>{key}</span>
            <span className={styles.diffValue}>{formatValue(value)}</span>
          </div>
        ))}
      </div>
      {action.status === 'pending' && (
        <div className={styles.actionButtons}>
          <button type="button" className={styles.actionConfirm} onClick={onConfirm}>
            {t('inkeep_ai_bot.action_confirm')}
          </button>
          <button type="button" className={styles.actionCancel} onClick={onCancel}>
            {t('inkeep_ai_bot.action_cancel')}
          </button>
        </div>
      )}
      {action.message && <div className={styles.error}>{action.message}</div>}
    </div>
  );
}

export default ProposedActionCard;
