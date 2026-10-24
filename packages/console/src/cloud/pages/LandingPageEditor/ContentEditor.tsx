import { useState } from 'react';

import styles from './index.module.scss';

// Generic editor for the landing page copy. It follows the shape of the content: text for strings,
// one line per item for lists of strings, and a nested group for each object or list of objects.
// Editable object collections stay within the schema's 1–12 item limits.

type Props = {
  readonly label: string;
  readonly value: unknown;
  readonly onChange: (next: unknown) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const humanize = (key: string) => key.replaceAll(/([A-Z])/g, ' $1').toLowerCase();

// Plain names for the field keys the schema uses most, with a hint where the meaning is not obvious.
const fieldLabels: Record<string, string> = {
  headline: 'Headline',
  lede: 'Intro text',
  primaryCta: 'Main button',
  secondaryCta: 'Second button',
  label: 'Button text',
  href: 'Where the button goes',
  heading: 'Heading',
  body: 'Text',
  kicker: 'Small label above the heading',
  proofLabel: 'Trust line above the logos',
  enabled: 'Demo chat on the site',
};

const fieldHints: Record<string, string> = {
  Headline: 'Each line is one row of the headline. Keep each line short.',
  'Intro text': 'One or two sentences under the headline.',
  'Where the button goes':
    'A page on this site (starts with /), or a full web address (starts with https://).',
  'Button text': 'The words on the button.',
  'Demo chat on the site':
    'Off keeps the static request form on the site. Changes reach the site when you publish.',
};

const hintFor = (label: string) => fieldHints[label];

const labelFor = (key: string) => fieldLabels[key] ?? humanize(key);

// The name shown on a collapsed list item: its heading if it has one, otherwise its first text.
const summaryFor = (item: Record<string, unknown>): string => {
  if (typeof item.heading === 'string' && item.heading) {
    return item.heading;
  }

  return (
    Object.values(item).find(
      (child): child is string => typeof child === 'string' && child.length > 0
    ) ?? ''
  );
};

type LinesProps = {
  readonly label: string;
  readonly value: string[];
  readonly onChange: (next: string[]) => void;
};

function LinesField({ label, value, onChange }: LinesProps) {
  // Keep the raw text while typing, so a trailing newline is not dropped before the next line.
  const [text, setText] = useState(value.join('\n'));

  return (
    <label className={styles.field}>
      <span>{label}</span>
      <small className={styles.hint}>One line per row. Empty lines are ignored.</small>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(
            event.target.value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
          );
        }}
      />
    </label>
  );
}

function ContentEditor({ label, value, onChange }: Props) {
  if (typeof value === 'string') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        {hintFor(label) ? <small className={styles.hint}>{hintFor(label)}</small> : undefined}
        {value.length > 60 ? (
          <textarea
            className={styles.longText}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        ) : (
          <input
            className={/href$/i.test(label) ? styles.mono : undefined}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        )}
      </label>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <label className={styles.checkField}>
        <input
          type="checkbox"
          checked={value}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <span>{label}</span>
        {hintFor(label) ? <small className={styles.hint}>{hintFor(label)}</small> : undefined}
      </label>
    );
  }

  if (isStringList(value)) {
    return <LinesField label={label} value={value} onChange={onChange} />;
  }

  if (Array.isArray(value)) {
    const isObjectCollection = value.every((item: unknown) => isRecord(item));
    return (
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>{label}</legend>
        {isObjectCollection && value.length > 0 && (
          <button
            type="button"
            className={styles.collectionAction}
            disabled={value.length >= 12}
            onClick={() => {
              const template = value.at(-1);
              if (isRecord(template)) {
                onChange([...value, JSON.parse(JSON.stringify(template))]);
              }
            }}
          >
            Add {label.toLowerCase()}
          </button>
        )}
        {value.map((item: unknown, index) => {
          const itemLabel = `${label} ${index + 1}`;
          const onItemChange = (next: unknown) => {
            onChange(
              value.map((existing: unknown, position: number): unknown =>
                position === index ? next : existing
              )
            );
          };

          if (!isRecord(item)) {
            return (
              <ContentEditor
                // Items are fixed in count and order, so the position is a stable identity here.
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                label={itemLabel}
                value={item}
                onChange={onItemChange}
              />
            );
          }

          // Object items fold into one row each, so a long list reads as a list until one is opened.
          return (
            <details
              // Items are fixed in count and order, so the position is a stable identity here.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className={styles.item}
              open={index === 0}
            >
              <summary className={styles.itemSummary}>
                <span className={styles.itemIndex}>{itemLabel}</span>
                <span className={styles.itemName}>{summaryFor(item)}</span>
              </summary>
              <div className={styles.itemBody}>
                {isObjectCollection && value.length > 1 && (
                  <button
                    type="button"
                    className={styles.collectionAction}
                    aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
                    onClick={() => {
                      onChange(value.filter((_: unknown, position: number) => position !== index));
                    }}
                  >
                    Remove
                  </button>
                )}
                <ContentEditor label="" value={item} onChange={onItemChange} />
              </div>
            </details>
          );
        })}
      </fieldset>
    );
  }

  if (isRecord(value)) {
    return (
      <fieldset className={styles.group}>
        {label ? <legend className={styles.groupTitle}>{label}</legend> : undefined}
        {Object.entries(value).map(([key, child]) => (
          <ContentEditor
            key={key}
            label={labelFor(key)}
            value={child}
            onChange={(next) => {
              onChange({ ...value, [key]: next });
            }}
          />
        ))}
      </fieldset>
    );
  }

  return null;
}

export { isRecord };
export default ContentEditor;
