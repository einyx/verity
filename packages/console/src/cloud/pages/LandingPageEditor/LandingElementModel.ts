import { z } from 'zod';

import { isRecord } from './ContentEditor';

const identifier = z
  .string()
  .regex(/^[\w-]{1,100}$/)
  .refine((key) => !['__proto__', 'prototype', 'constructor'].includes(key));
const path = z
  .string()
  .max(250)
  .refine((value) =>
    value
      .split('.')
      .every(
        (key) => /^[\w-]+$/.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key)
      )
  );
const properties = {
  text: z.string().optional(),
  href: z.string().optional(),
  src: z.string().optional(),
  alt: z.string().optional(),
  fit: z.enum(['cover', 'contain']).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
};
export const elementSelectionGuard = z
  .object({
    id: identifier,
    kind: z.enum(['text', 'link', 'image', 'navigation']),
    sectionId: z.string().max(100).optional(),
    fields: z
      .object({
        text: path.optional(),
        href: path.optional(),
        src: path.optional(),
        alt: path.optional(),
      })
      .strict(),
    values: z.object(properties).strict(),
  })
  .strict();
export type LandingElementSelection = z.infer<typeof elementSelectionGuard>;
export type ElementField = 'text' | 'href' | 'src' | 'alt' | 'fit' | 'x' | 'y';

export const readAtPath = (source: unknown, path_: string): unknown =>
  path_
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        isRecord(value) ? value[key] : Array.isArray(value) ? value[Number(key)] : undefined,
      source
    );

export const setAtPath = (source: unknown, path_: string, value: unknown): unknown => {
  if (path_ === '') {
    return value;
  }
  if (!path.safeParse(path_).success) {
    return source;
  }
  const [key, ...rest] = path_.split('.');
  if (!key) {
    return source;
  }
  if (Array.isArray(source)) {
    return source.map((item: unknown, index) =>
      index === Number(key) ? setAtPath(item, rest.join('.'), value) : item
    );
  }
  const record = isRecord(source) ? source : {};
  return { ...record, [key]: setAtPath(record[key], rest.join('.'), value) };
};

const boundFieldNames = new Set<ElementField>(['text', 'href', 'src', 'alt']);
type BoundFieldName = 'text' | 'href' | 'src' | 'alt';

const isBoundField = (field: ElementField): field is BoundFieldName => boundFieldNames.has(field);

const readBoundField = (
  selection: LandingElementSelection,
  field: ElementField
): string | undefined => (isBoundField(field) ? selection.fields[field] : undefined);

export const elementFieldPath = (
  document_: unknown,
  selection: LandingElementSelection,
  field: ElementField
): string | undefined => {
  const boundPath = readBoundField(selection, field);
  if (!boundPath) {
    return `elements.${selection.id}.${field}`;
  }
  if (!boundPath.startsWith('sections.')) {
    return boundPath.startsWith('copy.') ? boundPath : undefined;
  }
  const sections =
    isRecord(document_) && Array.isArray(document_.sections) ? document_.sections : [];
  const index = sections.findIndex(
    (section: unknown) => isRecord(section) && section.id === selection.sectionId
  );
  const suffix = boundPath.split('.').slice(2).join('.');
  const resolved = `sections.${index}.${suffix}`;
  return index >= 0 && typeof readAtPath(document_, resolved) === 'string' ? resolved : undefined;
};

/** Control characters and backslashes can smuggle a scheme past a URL check. */
const hasUnsafeCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x20 || code === 0x5c;
  });

export const validElementValue = (field: ElementField, value: unknown): boolean => {
  if (field === 'x' || field === 'y') {
    return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 400;
  }
  if (field === 'fit') {
    return value === 'cover' || value === 'contain';
  }
  if (typeof value !== 'string') {
    return false;
  }
  if (field === 'src') {
    try {
      return value.length <= 2048 && new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }
  if (field === 'href') {
    if (hasUnsafeCharacter(value)) {
      return false;
    }
    if (value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) {
      return value.length <= 2048;
    }
    try {
      return value.length <= 2048 && new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }
  return value.length <= (field === 'alt' ? 300 : 1000);
};

export const updateElementField = (
  document_: unknown,
  selection: LandingElementSelection,
  field: ElementField,
  value: unknown
): unknown => {
  if (!elementSelectionGuard.safeParse(selection).success || !validElementValue(field, value)) {
    return document_;
  }
  const resolved = elementFieldPath(document_, selection, field);
  return resolved ? setAtPath(document_, resolved, value) : document_;
};
