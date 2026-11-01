import { isRecord } from './ContentEditor';
import { documentsEqual } from './use-draft-session';

type Change = { path: string; before: string; after: string };

const title = (key: string) =>
  /^\d+$/.test(key)
    ? `Item ${Number(key) + 1}`
    : key
        .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/^./, (letter) => letter.toUpperCase());

const display = (value: unknown) => {
  if (value === undefined || value === null) {
    return 'Not set';
  }
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  return String(value);
};

/** Compare JSON leaves so reviews show changed copy, never an opaque document-sized JSON blob. */
export const draftChanges = (before: unknown, after: unknown, path: string[] = []): Change[] => {
  if (documentsEqual(before, after)) {
    return [];
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    const left: unknown[] = Array.isArray(before) ? before : [];
    const right: unknown[] = Array.isArray(after) ? after : [];
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => index).flatMap(
      (index) => draftChanges(left[index], right[index], [...path, String(index)])
    );
  }
  if (isRecord(before) || isRecord(after)) {
    const left = isRecord(before) ? before : {};
    const right = isRecord(after) ? after : {};
    return [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .slice()
      .sort()
      .flatMap((key) => draftChanges(left[key], right[key], [...path, key]));
  }
  return [
    {
      path: path.map((key) => title(key)).join(' › '),
      before: display(before),
      after: display(after),
    },
  ];
};
