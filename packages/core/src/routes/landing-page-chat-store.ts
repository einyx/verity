import { adminTenantId } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import { type DemoLead } from './landing-page-chat-guard.js';

type RecordedChatMessage = { readonly role: 'user' | 'assistant'; readonly content: string };

/**
 * One visitor conversation, as it stands after a turn. Only the visitor's and the assistant's text
 * and the lead fields are included. Docs excerpts and other model context are never passed in.
 */
export type RecordedChatTurn = {
  readonly sessionId: string;
  readonly messages: readonly RecordedChatMessage[];
  readonly lead?: DemoLead;
  readonly submitted: boolean;
};

/** Saves the latest state of a conversation in the admin tenant. One row per session, replaced each turn. */
export const recordLandingChatTurn = async (
  pool: CommonQueryMethods,
  turn: RecordedChatTurn
): Promise<void> => {
  await pool.query(sql`
    insert into landing_chat_sessions (id, tenant_id, session_id, messages, lead, submitted)
    values (
      ${generateStandardId()},
      ${adminTenantId},
      ${turn.sessionId},
      ${sql.jsonb([...turn.messages])},
      ${turn.lead ? sql.jsonb(turn.lead) : null},
      ${turn.submitted}
    )
    on conflict (tenant_id, session_id) do update
      set messages = excluded.messages,
        lead = excluded.lead,
        submitted = excluded.submitted,
        updated_at = now()
  `);
};

/**
 * Saves the conversation after a turn. A failed save never changes the reply the visitor gets. The
 * log line names no conversation or contact details.
 */
export const recordTurnSafely = async (
  record: ((turn: RecordedChatTurn) => Promise<void>) | undefined,
  turn: RecordedChatTurn
): Promise<void> => {
  try {
    await record?.(turn);
  } catch {
    // eslint-disable-next-line no-console -- The chat route has no request logger, and this message holds no conversation text.
    console.error('Landing page chat: a conversation turn could not be recorded.');
  }
};
