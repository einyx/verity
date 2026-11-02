import { randomUUID } from 'node:crypto';

import { type ChatScope } from '@logto/schemas';
import { createInterceptorsPreset, createPool, type DatabasePool, sql } from '@silverhand/slonik';

import { proposePendingAction } from './ai-chat-actions.js';
import { createSessionActionStore } from './ai-chat-session-actions.js';
import { createTurnProposalStore } from './ai-chat-session-proposals.js';
import { createChatSessionStore } from './ai-chat-session-store.js';
import { createChatTurnStore } from './ai-chat-session-turn-store.js';

export const createSessionTestPool = async (url: string, schema: string, role?: string) =>
  createPool(url, {
    interceptors: [
      ...createInterceptorsPreset(),
      {
        afterPoolConnection: async (_, connection) => {
          await connection.query(sql`set search_path to ${sql.identifier([schema])}`);
          if (role) {
            await connection.query(sql`set role ${sql.identifier([role])}`);
          }
          return null;
        },
      },
    ],
  });

export const sessionLoadTests = (
  owner: () => DatabasePool,
  other: () => DatabasePool,
  scope: ChatScope
) => {
  it('loads every fresh session resource through the production pool interceptors', async () => {
    const sessions = createChatSessionStore(owner());
    const session = await sessions.create(scope, randomUUID());
    expect(await sessions.get(scope, session.id)).toEqual(session);
    expect(await sessions.getComposer(scope, session.id)).toMatchObject({ text: '', revision: 0 });
    expect(await sessions.messages(scope, session.id)).toEqual({ items: [], nextCursor: null });
    expect(await createSessionActionStore(owner()).getSessionReviews(scope, session.id)).toEqual(
      []
    );
    expect(await createChatTurnStore(owner()).get(scope, session.id)).toBeUndefined();
    const stranger = { ...scope, userId: 'other-account' };
    await expect(
      createSessionActionStore(owner()).getSessionReviews(stranger, session.id)
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await createChatTurnStore(owner()).get(stranger, session.id)).toBeUndefined();
    await expect(
      createSessionActionStore(other()).getSessionReviews(scope, session.id)
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await createChatTurnStore(other()).get(scope, session.id)).toBeUndefined();
  });

  it('reloads populated messages, composer, turns and reviews without executing a proposal', async () => {
    const pool = owner();
    const sessions = createChatSessionStore(pool);
    const { id } = await sessions.create(scope, randomUUID());
    const turns = createChatTurnStore(pool);
    const claim = await turns.claim(scope, id, {
      requestId: randomUUID(),
      expectedTranscriptRevision: 0,
      composerRevision: 0,
      text: 'Synthetic local question',
      attachments: [],
    });
    if (claim.kind !== 'claimed') {
      throw new Error('Missing synthetic turn');
    }
    const proposal = await proposePendingAction({
      store: createTurnProposalStore(pool, scope, id, claim.turn.id, claim.leaseToken),
      tool: 'create_organization',
      args: { name: 'Synthetic unexecuted review' },
      ...scope,
      now: new Date(),
    });
    if (!proposal.ok) {
      throw new Error('Missing synthetic review');
    }
    await turns.complete(scope, id, claim.turn.id, claim.leaseToken, {
      content: 'Synthetic local answer',
      proposalIds: [proposal.action.id],
    });
    expect(await sessions.get(scope, id)).toMatchObject({ id, transcriptRevision: 2 });
    expect(await sessions.getComposer(scope, id)).toMatchObject({ text: '', revision: 1 });
    const messages = await sessions.messages(scope, id);
    expect(messages.items).toHaveLength(2);
    expect(await turns.get(scope, id)).toMatchObject({ id: claim.turn.id, state: 'completed' });
    expect(await createSessionActionStore(pool).getSessionReviews(scope, id)).toMatchObject([
      { currentActionId: proposal.action.id, state: 'pending' },
    ]);
  });
};
