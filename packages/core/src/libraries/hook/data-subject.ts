import { pick } from '@silverhand/essentials';

// Process-local provenance, never a public payload field. A user-shaped JSON object is not proof
// of identity: custom-data/profile responses may contain private, arbitrarily named fields.
const subjects = new WeakMap<Record<string, unknown>, Record<string, unknown>>();

const isRecord = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null && !Array.isArray(data);

/** Call only at a known entity-response or typed entity producer, not from payload shape checks. */
export const registerHookDataSubject = <T>(data: T): T => {
  if (isRecord(data)) {
    subjects.set(data, pick(data, 'id', 'name', 'username', 'isSuspended'));
  }
  return data;
};

export const getHookDataSubject = (data: unknown): Record<string, unknown> | undefined =>
  isRecord(data) ? subjects.get(data) : undefined;
