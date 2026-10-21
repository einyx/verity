import { adminTenantId } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import { type DemoLead } from './landing-page-chat-guard.js';
import { type CompanyProfile } from './landing-page-company.js';

export type RecordedChatMessage = { readonly role: 'user' | 'assistant'; readonly content: string };

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

/** Saves the company profile on the lead of one conversation in the admin tenant. */
export const saveLeadCompanyProfile = async (
  pool: CommonQueryMethods,
  sessionId: string,
  profile: CompanyProfile
): Promise<void> => {
  await pool.query(sql`
    update landing_leads
    set company_profile = ${sql.jsonb({ ...profile, sources: [...profile.sources] })},
      updated_at = now()
    where tenant_id = ${adminTenantId}
      and session_id = ${sessionId}
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

/** Days a visitor's transcript and any lead that never reached the sales inbox are kept. */
export const chatRecordRetentionDays = 90;

/**
 * Deletes transcripts and unsent leads older than the retention period. A lead whose email was sent
 * stays, since the sales inbox holds it as the handoff record. Runs from the chat's turn recording, a
 * fraction of the time, so the cost stays small and the tables still shrink over time.
 */
export const pruneLandingChatRecords = async (pool: CommonQueryMethods): Promise<void> => {
  await pool.query(sql`
    delete from landing_chat_sessions
    where tenant_id = ${adminTenantId}
      and updated_at < now() - make_interval(days => ${chatRecordRetentionDays})
  `);
  await pool.query(sql`
    delete from landing_leads
    where tenant_id = ${adminTenantId}
      and email_status <> 'sent'
      and updated_at < now() - make_interval(days => ${chatRecordRetentionDays})
  `);
};

/** Merges the conversation insight into the lead's stored profile in the admin tenant. */
export const saveLeadConversationInsight = async (
  pool: CommonQueryMethods,
  sessionId: string,
  insight: { tone: string; outcomes: string[]; nextSteps: string[] }
): Promise<void> => {
  await pool.query(sql`
    update landing_leads
    set company_profile = coalesce(company_profile, '{}'::jsonb) || ${sql.jsonb({ conversation: insight })},
      updated_at = now()
    where tenant_id = ${adminTenantId}
      and session_id = ${sessionId}
  `);
};

/**
 * Reads a saved conversation back, so a turn that lands on another instance continues the same chat
 * instead of starting over. Returns undefined when the session was never saved.
 */
/** Whether a lead is saved for this conversation. Read before a turn saves its own lead, so a retry sees it. */
export const loadLandingLeadFiled = async (
  pool: CommonQueryMethods,
  sessionId: string
): Promise<boolean> => {
  const row = await pool.one<{ filed: boolean }>(sql`
    select exists(
      select 1
      from landing_leads
      where tenant_id = ${adminTenantId}
        and session_id = ${sessionId}
    ) as filed
  `);

  return row.filed;
};

export const loadLandingChatSession = async (
  pool: CommonQueryMethods,
  sessionId: string
): Promise<{ messages: RecordedChatMessage[]; submitted: boolean } | undefined> => {
  const row = await pool.maybeOne<{ messages: unknown; submitted: boolean }>(sql`
    select messages, submitted
    from landing_chat_sessions
    where tenant_id = ${adminTenantId}
      and session_id = ${sessionId}
  `);

  if (!row || !Array.isArray(row.messages)) {
    return;
  }

  const messages = row.messages.flatMap((item: unknown): RecordedChatMessage[] =>
    typeof item === 'object' &&
    item !== null &&
    'role' in item &&
    'content' in item &&
    (item.role === 'user' || item.role === 'assistant') &&
    typeof item.content === 'string'
      ? [{ role: item.role, content: item.content }]
      : []
  );

  return { messages, submitted: row.submitted };
};
