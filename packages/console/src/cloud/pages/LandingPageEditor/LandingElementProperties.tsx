import { useEffect, useState } from 'react';

import {
  elementFieldPath,
  readAtPath,
  validElementValue,
  type ElementField,
  type LandingElementSelection,
} from './LandingElementModel';
import LandingImageSourceField from './LandingImageSourceField';
import styles from './index.module.scss';

function PropertyInput({
  label,
  field,
  value,
  onChange,
}: {
  readonly label: string;
  readonly field: ElementField;
  readonly value: string;
  readonly onChange: (field: ElementField, value: unknown) => void;
}) {
  const [input, setInput] = useState(value);
  const [error, setError] = useState(false);
  useEffect(() => {
    setInput(value);
    setError(false);
  }, [value]);
  return (
    <label className={styles.elementField}>
      <span>{label}</span>
      <input
        value={input}
        aria-invalid={error}
        onChange={(event) => {
          const next = event.target.value;
          setInput(next);
          const parsed = field === 'x' || field === 'y' ? Number(next) : next;
          const valid = validElementValue(field, parsed);
          setError(!valid);
          if (valid) {
            onChange(field, parsed);
          }
        }}
      />
      {error && (
        <span role="alert">
          {field === 'href'
            ? 'Use a site path, anchor, or HTTPS URL.'
            : field === 'src'
              ? 'Use an HTTPS image URL.'
              : 'Enter a supported value (position: -400 to 400).'}
        </span>
      )}
    </label>
  );
}

export default function LandingElementProperties({
  selection,
  document,
  onChange,
  onClose,
}: {
  readonly selection: LandingElementSelection;
  readonly document: unknown;
  readonly onChange: (field: ElementField, value: unknown) => void;
  readonly onClose: () => void;
}) {
  const valueFor = (field: ElementField) => {
    const path = elementFieldPath(document, selection, field);
    const current = path ? readAtPath(document, path) : undefined;
    if (typeof current === 'string' || typeof current === 'number') {
      return String(current);
    }
    return String(selection.values[field] ?? '');
  };
  return (
    <aside className={styles.elementProperties} aria-label="Element properties">
      <header>
        <h2>Edit {selection.kind}</h2>
        <button type="button" aria-label="Close element properties" onClick={onClose}>
          ×
        </button>
      </header>
      {'text' in selection.values && (
        <PropertyInput label="Text" field="text" value={valueFor('text')} onChange={onChange} />
      )}
      {'href' in selection.values && (
        <PropertyInput
          label="Destination"
          field="href"
          value={valueFor('href')}
          onChange={onChange}
        />
      )}
      {selection.kind === 'image' && (
        <>
          <PropertyInput
            label="Image URL"
            field="src"
            value={valueFor('src')}
            onChange={onChange}
          />
          <LandingImageSourceField
            value={valueFor('src')}
            label="Upload image"
            onChange={(src) => {
              if (validElementValue('src', src)) {
                onChange('src', src);
              }
            }}
          />
          <PropertyInput label="Alt text" field="alt" value={valueFor('alt')} onChange={onChange} />
          <label className={styles.elementField}>
            <span>Image fit</span>
            <select
              value={valueFor('fit') || 'cover'}
              onChange={(event) => {
                onChange('fit', event.target.value);
              }}
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
            </select>
          </label>
        </>
      )}
      {['image', 'link', 'navigation'].includes(selection.kind) && (
        <>
          <PropertyInput
            label="Horizontal offset"
            field="x"
            value={valueFor('x') || '0'}
            onChange={onChange}
          />
          <PropertyInput
            label="Vertical offset"
            field="y"
            value={valueFor('y') || '0'}
            onChange={onChange}
          />
        </>
      )}
      <p>Changes stay in your draft until you publish.</p>
    </aside>
  );
}
