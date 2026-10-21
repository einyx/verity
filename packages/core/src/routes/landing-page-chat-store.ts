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

type LeadEmailStatus = 'pending' | 'sent' | 'failed';

export type LeadRecord = {
  readonly sessionId: string;
  readonly lead: DemoLead;
  readonly emailStatus: LeadEmailStatus;
};

/**
 * Saves a lead in the admin tenant, one row per session. It is written before the email is sent, so a
 * lead survives a delivery failure, and updated with the delivery result afterwards.
 */
export const recordLandingLead = async (
  pool: CommonQueryMethods,
  record: LeadRecord
): Promise<void> => {
  await pool.query(sql`
    insert into landing_leads (id, tenant_id, session_id, lead, email_status)
    values (
      ${generateStandardId()},
      ${adminTenantId},
      ${record.sessionId},
      ${sql.jsonb({ ...record.lead })},
      ${record.emailStatus}
    )
    on conflict (tenant_id, session_id) do update
      set lead = excluded.lead,
        email_status = excluded.email_status,
        updated_at = now()
  `);
};

/** Saves a lead without letting a failed save change the visitor's reply. The log names no contact details. */
export const recordLeadSafely = async (
  record: ((lead: LeadRecord) => Promise<void>) | undefined,
  lead: LeadRecord
): Promise<void> => {
  try {
    await record?.(lead);
  } catch {
    // eslint-disable-next-line no-console -- The chat route has no request logger, and this message holds no contact details.
    console.error('Landing page chat: a lead could not be recorded.');
  }
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
