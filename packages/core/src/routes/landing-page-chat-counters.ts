import { adminTenantId } from '@logto/schemas';
import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import type { ChatHitStore } from './landing-page-chat-guard.js';

/**
 * A fixed-window counter in the admin tenant's database, shared by every instance. Each hit is one
 * atomic upsert that returns the count for the current window. A database error rejects, so callers
 * can fail closed rather than let the visitor through unlimited.
 */
export const createSharedHitStore = (getPool: () => Promise<CommonQueryMethods>): ChatHitStore => ({
  async hit(key, windowMs, limit, now) {
    const pool = await getPool();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs).toISOString();
    const { hits } = await pool.one<{ hits: number }>(sql`
      insert into landing_chat_rate_counters (tenant_id, counter_key, window_start, hits)
      values (${adminTenantId}, ${`${windowMs}:${key}`}, ${windowStart}, 1)
      on conflict (tenant_id, counter_key) do update
        set window_start = greatest(landing_chat_rate_counters.window_start, excluded.window_start),
          hits = case when landing_chat_rate_counters.window_start < excluded.window_start
            then 1 else landing_chat_rate_counters.hits + 1 end
      returning hits
    `);

    return hits <= limit;
  },
});
