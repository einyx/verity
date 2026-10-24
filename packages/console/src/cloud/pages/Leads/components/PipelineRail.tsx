import classNames from 'classnames';
import { useId } from 'react';

import type { PipelineRow } from '../lead-stats';

import styles from './PipelineRail.module.scss';

export type PipelineRailProps = {
  readonly rows: readonly PipelineRow[];
};

export default function PipelineRail({ rows }: PipelineRailProps) {
  const headingId = useId();

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Pipeline
      </h2>
      <p className={styles.subtitle}>Share of leads by stage</p>
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Preserve list semantics in Safari when list-style is none. */}
      <ul className={styles.list} role="list">
        {rows.map((row) => {
          const share = Number.isNaN(row.share) ? 0 : Math.min(1, Math.max(0, row.share));

          return (
            <li key={row.key} className={styles.row}>
              <div className={styles.summary}>
                <span className={styles.label}>{row.label}</span>
                <span className={styles.count}>{row.count}</span>
                <span className={styles.share}>{Math.round(share * 100)}%</span>
              </div>
              <div className={styles.track} aria-hidden="true">
                <div
                  data-testid="pipeline-bar"
                  aria-hidden="true"
                  className={classNames(styles.bar, row.isClosed && styles.closed)}
                  style={{ width: `${Math.round(share * 1000) / 10}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
