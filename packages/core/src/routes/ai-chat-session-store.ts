import {
  type ChatComposer,
  type UpdateSessionInput,
  type UpdateComposerInput,
  chatComposerGuard,
  chatSessionMaxStoredBytes,
  updateSessionInputGuard,
  updateComposerInputGuard,
  type ChatMessage,
  type ChatScope,
  type ChatSession,
  type SessionPage,
  chatMessageCursorGuard,
  chatMessageGuard,
  chatMessagePageSize,
  chatSearchGuard,
  chatSessionCursorGuard,
  chatSessionGuard,
  chatSessionMaxCount,
  chatSessionPageSize,
  createSessionInputGuard,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { type DatabasePool, type DatabaseTransactionConnection, sql } from '@silverhand/slonik';
import { z } from 'zod/v3';

import { ChatSessionStoreError, reconcileOperation } from './ai-chat-session-operation.js';

export { ChatSessionStoreError } from './ai-chat-session-operation.js';

export type ChatSessionStore = {
  update: (scope: ChatScope, sessionId: string, input: UpdateSessionInput) => Promise<ChatSession>;
  remove: (scope: ChatScope, sessionId: string, expectedRevision: number) => Promise<void>;
  getComposer: (scope: ChatScope, sessionId: string) => Promise<ChatComposer>;
  saveComposer: (
    scope: ChatScope,
    sessionId: string,
    input: UpdateComposerInput
  ) => Promise<ChatComposer>;
  create: (scope: ChatScope, requestId: string) => Promise<ChatSession>;
  list: (
    scope: ChatScope,
    options: { archived: boolean; search?: string; cursor?: string }
  ) => Promise<SessionPage<ChatSession>>;
  get: (scope: ChatScope, sessionId: string) => Promise<ChatSession | undefined>;
  /** Empty for a missing or foreign session; the route can use get() for its 404. */
  messages: (
    scope: ChatScope,
    sessionId: string,
    cursor?: string
  ) => Promise<SessionPage<ChatMessage>>;
};

// Preserve PostgreSQL microseconds in both the response and the sort cursor. Rounding to JS
// milliseconds here would lose rows on a page boundary even with the id tie-breaker.
const sessionColumns = sql`
  id, title,
  to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "archivedAt",
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
  revision, transcript_revision as "transcriptRevision"
`;
const encodeCursor = (tuple: ReadonlyArray<string | number>) =>
  Buffer.from(JSON.stringify(tuple)).toString('base64url');
const decodeCursor = (cursor: string): unknown =>
  JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

const ownedWhere = ({ tenantId, userId }: ChatScope, id: string) =>
  sql`tenant_id = ${tenantId} and user_id = ${userId} and id = ${id}`;
const composerWhere = ({ tenantId, userId }: ChatScope, id: string) =>
  sql`tenant_id = ${tenantId} and user_id = ${userId} and session_id = ${id}`;
const composerColumns = sql`revision, text, attachments,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"`;
const lockSession = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  id: string
) => {
  const row = await connection.maybeOne(
    sql`select ${sessionColumns} from ai_chat_sessions where ${ownedWhere(scope, id)} for update`
  );
  if (!row) {
    throw new ChatSessionStoreError('not_found');
  }
  return chatSessionGuard.parse(row);
};
const checkRevision = (actual: number, expected: number) => {
  if (actual !== expected) {
    throw new ChatSessionStoreError('revision_conflict', actual);
  }
};

const composerBytes = ({ text, attachments }: Pick<ChatComposer, 'text' | 'attachments'>) =>
  Buffer.byteLength(text, 'utf8') +
  attachments.reduce(
    (total, attachment) =>
      total +
      Buffer.byteLength(attachment.name, 'utf8') +
      Buffer.byteLength(attachment.text, 'utf8'),
    0
  );

export const createChatSessionStore = (pool: DatabasePool): ChatSessionStore => ({
  update: async (scope, id, input) => {
    updateSessionInputGuard.parse(input);
    return pool.transaction(async (connection) => {
      const session = await lockSession(connection, scope, id);
      checkRevision(session.revision, input.expectedRevision);
      if (session.archivedAt !== null && (input.archived !== false || input.title !== undefined)) {
        throw new ChatSessionStoreError('session_archived');
      }
      if (input.archived === true) {
        await reconcileOperation(connection, scope, id);
      }
      const row = await connection.one(sql`
        update ai_chat_sessions set title = ${input.title ?? session.title},
          archived_at = ${input.archived === undefined ? session.archivedAt : input.archived ? new Date().toISOString() : null}::timestamptz,
          revision = revision + 1, updated_at = now() where ${ownedWhere(scope, id)} returning ${sessionColumns}
      `);
      return chatSessionGuard.parse(row);
    });
  },
  remove: async (scope, id, expectedRevision) => {
    z.number().int().nonnegative().safe().parse(expectedRevision);
    await pool.transaction(async (connection) => {
      const session = await lockSession(connection, scope, id);
      checkRevision(session.revision, expectedRevision);
      await reconcileOperation(connection, scope, id);
      await connection.query(sql`
        update ai_pending_actions a set state = 'cancelled', updated_at = now()
        where a.tenant_id = ${scope.tenantId} and a.user_id = ${scope.userId} and a.state = 'pending'
          and exists (select 1 from ai_chat_review_links l where l.tenant_id = a.tenant_id
            and l.user_id = a.user_id and l.session_id = ${id}
            and (l.current_action_id = a.id or l.original_action_id = a.id))
      `);
      await connection.query(sql`delete from ai_chat_sessions where ${ownedWhere(scope, id)}`);
    });
  },
  getComposer: async (scope, id) => {
    const row = await pool.maybeOne(
      sql`select ${composerColumns} from ai_chat_composers where ${composerWhere(scope, id)}`
    );
    if (!row) {
      throw new ChatSessionStoreError('not_found');
    }
    return chatComposerGuard.parse(row);
  },
  saveComposer: async (scope, id, input) => {
    updateComposerInputGuard.parse(input);
    return pool.transaction(async (connection) => {
      const session = await lockSession(connection, scope, id);
      if (session.archivedAt !== null) {
        throw new ChatSessionStoreError('session_archived');
      }
      const where = composerWhere(scope, id);
      const previous = chatComposerGuard.parse(
        await connection.one(sql`select ${composerColumns} from ai_chat_composers where ${where}`)
      );
      checkRevision(previous.revision, input.expectedRevision);
      const delta = composerBytes(input) - composerBytes(previous);
      const bytes = await connection.oneFirst<number>(
        sql`select stored_bytes from ai_chat_sessions where ${ownedWhere(scope, id)}`
      );
      if (bytes + delta > chatSessionMaxStoredBytes) {
        throw new ChatSessionStoreError('content_limit');
      }
      await connection.query(
        sql`update ai_chat_sessions set stored_bytes = stored_bytes + ${delta} where ${ownedWhere(scope, id)}`
      );
      return chatComposerGuard.parse(
        await connection.one(sql`
        update ai_chat_composers set text = ${input.text}, attachments = ${sql.jsonb(input.attachments)},
          revision = revision + 1, updated_at = now() where ${where} returning ${composerColumns}
      `)
      );
    });
  },
  create: async ({ tenantId, userId }, requestId) => {
    createSessionInputGuard.parse({ requestId });
    return pool.transaction(async (connection) => {
      // Serialize quota checks and idempotent creation for this owner, including the first row.
      await connection.query(
        sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([tenantId, userId])}, 0))`
      );
      const existing = await connection.maybeOne(sql`
        select ${sessionColumns} from ai_chat_sessions
        where tenant_id = ${tenantId} and user_id = ${userId} and creation_request_id = ${requestId}
      `);
      if (existing) {
        return chatSessionGuard.parse(existing);
      }
      const count = await connection.oneFirst<number>(sql`
        select count(*)::integer from ai_chat_sessions where tenant_id = ${tenantId} and user_id = ${userId}
      `);
      if (count >= chatSessionMaxCount) {
        throw new ChatSessionStoreError('content_limit');
      }
      const id = generateStandardId();
      const session = await connection.one(sql`
        insert into ai_chat_sessions (id, tenant_id, user_id, creation_request_id)
        values (${id}, ${tenantId}, ${userId}, ${requestId}) returning ${sessionColumns}
      `);
      await connection.query(sql`
        insert into ai_chat_composers (tenant_id, user_id, session_id)
        values (${tenantId}, ${userId}, ${id})
      `);
      await connection.query(sql`
        insert into ai_chat_operations (tenant_id, user_id, session_id)
        values (${tenantId}, ${userId}, ${id})
      `);
      return chatSessionGuard.parse(session);
    });
  },
  list: async ({ tenantId, userId }, { archived, search, cursor }) => {
    const searchClause =
      search === undefined
        ? sql``
        : sql`
      and title ilike ${`%${chatSearchGuard.parse(search).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`} escape '\\'
    `;
    const cursorClause = (() => {
      if (cursor === undefined) {
        return sql``;
      }
      chatSessionCursorGuard.parse(cursor);
      const [updatedAt, id] = z.tuple([z.string(), z.string()]).parse(decodeCursor(cursor));
      return sql`and (updated_at, id) < (${updatedAt}::timestamptz, ${id})`;
    })();
    const rows = await pool.any(sql`
      select ${sessionColumns} from ai_chat_sessions
      where tenant_id = ${tenantId} and user_id = ${userId}
        and (archived_at is not null) = ${archived} ${searchClause} ${cursorClause}
      order by updated_at desc, id desc limit ${chatSessionPageSize + 1}
    `);
    const items = rows.slice(0, chatSessionPageSize).map((row) => chatSessionGuard.parse(row));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > chatSessionPageSize && last ? encodeCursor([last.updatedAt, last.id]) : null,
    };
  },
  get: async ({ tenantId, userId }, sessionId) => {
    const row = await pool.maybeOne(sql`
      select ${sessionColumns} from ai_chat_sessions
      where tenant_id = ${tenantId} and user_id = ${userId} and id = ${sessionId}
    `);
    return row ? chatSessionGuard.parse(row) : undefined;
  },
  messages: async ({ tenantId, userId }, sessionId, cursor) => {
    const cursorClause = (() => {
      if (cursor === undefined) {
        return sql``;
      }
      chatMessageCursorGuard.parse(cursor);
      const [sequence] = z.tuple([z.number()]).parse(decodeCursor(cursor));
      return sql`and m.sequence < ${sequence}`;
    })();
    const rows = await pool.any(sql`
      select m.id, m.sequence, m.turn_id as "turnId", m.role, m.content,
        to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'originalActionId', l.original_action_id, 'currentActionId', l.current_action_id,
            'tool', a.tool, 'body', a.arguments,
            'expiresAt', to_char(a.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'state', case when a.state = 'pending' and a.expires_at <= clock_timestamp() then 'expired' else a.state end,
            'isError', case when jsonb_typeof(a.result->'isError') = 'boolean' then a.result->'isError' else 'null'::jsonb end
          ) order by l.id)
          from ai_chat_review_links l join ai_pending_actions a
            on a.id = l.current_action_id and a.tenant_id = l.tenant_id and a.user_id = l.user_id
          where l.tenant_id = m.tenant_id and l.user_id = m.user_id
            and l.session_id = m.session_id and l.message_id = m.id
        ), '[]'::jsonb) as reviews
      from ai_chat_messages m
      where m.tenant_id = ${tenantId} and m.user_id = ${userId} and m.session_id = ${sessionId}
        ${cursorClause}
      order by m.sequence desc limit ${chatMessagePageSize + 1}
    `);
    const descending = rows.slice(0, chatMessagePageSize).map((row) => chatMessageGuard.parse(row));
    const oldest = descending.at(-1);
    return {
      items: descending.toReversed(),
      nextCursor:
        rows.length > chatMessagePageSize && oldest ? encodeCursor([oldest.sequence]) : null,
    };
  },
});
