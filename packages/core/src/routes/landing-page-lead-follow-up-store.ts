import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import { createPendingActionStore } from './ai-chat-actions.js';
import { type FollowUpStore } from './landing-page-lead-follow-up.js';

/** Existing tenant-scoped pending actions provide a durable message audit without a migration. */
export const createFollowUpStore = (pool: CommonQueryMethods): FollowUpStore => ({
  ...createPendingActionStore(pool),
  reserve: async (action) => {
    await pool.query(sql`
      insert into ai_pending_actions
        (id, tenant_id, user_id, tool, arguments, arguments_hash, state, expires_at)
      values (${action.id}, ${action.tenantId}, ${action.userId}, ${action.tool},
        ${JSON.stringify(action.body)}::jsonb, ${action.bodyHash}, ${action.state}, ${action.expiresAt.toISOString()})
      on conflict (id) do nothing
    `);
  },
});
