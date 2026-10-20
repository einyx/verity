import type { ReactNode } from 'react';

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

type Props = {
  readonly name: string;
  readonly value: unknown;
};

function LivePreview({ name, value }: Props) {
  return (
    <aside className={styles.preview} aria-label="Live preview">
      <div className={styles.previewLabel}>Live preview</div>
      <PreviewNode name={name} value={value} />
    </aside>
  );
}

export default LivePreview;
