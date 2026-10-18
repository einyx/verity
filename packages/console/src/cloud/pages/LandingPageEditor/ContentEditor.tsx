import { useState } from 'react';

import styles from './index.module.scss';

// Generic editor for the landing page copy. It follows the shape of the content: text for strings,
// one line per item for lists of strings, and a nested group for each object or list of objects.
// The list lengths and text limits are fixed by the schema, so the editor never adds or removes
// items; the server validates the whole document on save.

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
      <span>{label} (one line each)</span>
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
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </label>
    );
  }

  if (isStringList(value)) {
    return <LinesField label={label} value={value} onChange={onChange} />;
  }

  if (Array.isArray(value)) {
    return (
      <fieldset className={styles.group}>
        <legend>{label}</legend>
        {value.map((item: unknown, index) => (
          <ContentEditor
            // Items are fixed in count and order, so the position is a stable identity here.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            label={`${label} ${index + 1}`}
            value={item}
            onChange={(next) => {
              onChange(
                value.map((existing: unknown, position: number): unknown =>
                  position === index ? next : existing
                )
              );
            }}
          />
        ))}
      </fieldset>
    );
  }

  if (isRecord(value)) {
    return (
      <fieldset className={styles.group}>
        {label ? <legend>{label}</legend> : undefined}
        {Object.entries(value).map(([key, child]) => (
          <ContentEditor
            key={key}
            label={humanize(key)}
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
