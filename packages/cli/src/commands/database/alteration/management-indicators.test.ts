import type { DatabaseTransactionConnection, SqlSqlToken } from '@silverhand/slonik';
import { describe, expect, it, vi } from 'vitest';

import alteration from '../../../../../schemas/alterations/1.45.0-1791600000-meshx-management-indicators.js';

describe('management indicator rollback SQL', () => {
  it('preserves regex backslashes using bound values instead of an invalid cooked template', async () => {
    const query = vi.fn<(token: SqlSqlToken) => Promise<void>>().mockResolvedValue();
    const pool = { query } as unknown as DatabaseTransactionConnection;
    await alteration.down(pool);
    const token = query.mock.calls[0]?.[0];
    expect(token?.sql).not.toContain('undefined');
    expect(token?.values).toEqual([
      String.raw`^https://([^.]+)\.meshx\.foundation/api$`,
      String.raw`https://\1.logto.app/api`,
      String.raw`^https://([^.]+)\.meshx\.foundation/api$`,
    ]);
  });
});
