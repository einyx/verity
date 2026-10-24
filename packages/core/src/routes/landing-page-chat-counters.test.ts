import { adminTenantId } from '@logto/schemas';
import type { CommonQueryMethods } from '@silverhand/slonik';

import { createSharedHitStore } from './landing-page-chat-counters.js';

/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutating-methods, @silverhand/fp/no-mutation -- the fake pool records bound values and counts its calls. */

/** A pool that answers each upsert with the next count, and records the bound values it was given. */
const fakePool = (counts: number[]) => {
  const bound: unknown[][] = [];
  let next = 0;

  const pool = {
    query: async () => null,
    one: async (query: { values: unknown[] }) => {
      bound.push(query.values);
      const hits = counts[next] ?? 0;
      next += 1;

      return { hits };
    },
  };

  return { pool: pool as unknown as CommonQueryMethods, bound };
};

describe('createSharedHitStore', () => {
  it('allows hits up to the limit within a window, then refuses', async () => {
    const { pool } = fakePool([1, 2, 3]);
    const store = createSharedHitStore(async () => pool);

    expect(await store.hit('1.2.3.4', 60_000, 2, 0)).toBe(true);
    expect(await store.hit('1.2.3.4', 60_000, 2, 0)).toBe(true);
    expect(await store.hit('1.2.3.4', 60_000, 2, 0)).toBe(false);
  });
  it('writes to the admin tenant under a key that includes the window length', async () => {
    const { pool, bound } = fakePool([1]);
    const store = createSharedHitStore(async () => pool);

    await store.hit('1.2.3.4', 60_000, 15, 0);

    expect(bound[0]).toContain(adminTenantId);
    expect(bound[0]).toContain('60000:1.2.3.4');
  });

  it('keeps windows of different lengths apart', async () => {
    const { pool, bound } = fakePool([1, 1]);
    const store = createSharedHitStore(async () => pool);

    await store.hit('1.2.3.4', 60_000, 15, 0);
    await store.hit('1.2.3.4', 3_600_000, 120, 0);

    expect(bound[0]).toContain('60000:1.2.3.4');
    expect(bound[1]).toContain('3600000:1.2.3.4');
  });

  it('rejects when the database fails, so callers can fail closed', async () => {
    const failing = {
      one: async () => {
        throw new Error('connection refused');
      },
    };
    const store = createSharedHitStore(async () => failing as unknown as CommonQueryMethods);

    await expect(store.hit('1.2.3.4', 60_000, 15, 0)).rejects.toThrow('connection refused');
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutating-methods, @silverhand/fp/no-mutation */
