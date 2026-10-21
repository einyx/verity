import { adminTenantId } from '@logto/schemas';
import type { CommonQueryMethods } from '@silverhand/slonik';

import { chatRecordRetentionDays, pruneLandingChatRecords } from './landing-page-chat-store.js';

/* eslint-disable @silverhand/fp/no-mutating-methods -- the fake pool records each statement it is given. */

/** A pool that records the SQL and bound values of every statement, and succeeds on each. */
const recordingPool = () => {
  const statements: Array<{ text: string; values: unknown[] }> = [];

  const pool = {
    query: async (query: { sql: string; values: unknown[] }) => {
      statements.push({ text: query.sql, values: query.values });

      return null;
    },
  };

  return { pool: pool as unknown as CommonQueryMethods, statements };
};

describe('pruneLandingChatRecords', () => {
  it('keeps records for 90 days', () => {
    expect(chatRecordRetentionDays).toBe(90);
  });

  it('deletes transcripts older than the retention period in the admin tenant', async () => {
    const { pool, statements } = recordingPool();

    await pruneLandingChatRecords(pool);

    const transcripts = statements.find(({ text }) => text.includes('landing_chat_sessions'));
    expect(transcripts?.text).toContain('delete from landing_chat_sessions');
    expect(transcripts?.text).toContain('make_interval(days =>');
    expect(transcripts?.values).toEqual(expect.arrayContaining([adminTenantId, 90]));
  });

  it('deletes only leads that never reached the sales inbox', async () => {
    const { pool, statements } = recordingPool();

    await pruneLandingChatRecords(pool);

    const leads = statements.find(({ text }) => text.includes('landing_leads'));
    expect(leads?.text).toContain('delete from landing_leads');
    expect(leads?.text).toContain("email_status <> 'sent'");
    expect(leads?.values).toEqual(expect.arrayContaining([adminTenantId, 90]));
  });

  it('runs both deletes and nothing else', async () => {
    const { pool, statements } = recordingPool();

    await pruneLandingChatRecords(pool);

    expect(statements).toHaveLength(2);
  });
});

/* eslint-enable @silverhand/fp/no-mutating-methods */
