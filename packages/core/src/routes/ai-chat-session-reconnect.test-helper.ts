import { randomUUID } from 'node:crypto';

import { type ChatScope } from '@logto/schemas';
import { type DatabasePool } from '@silverhand/slonik';

import { createChatSessionStore } from './ai-chat-session-store.js';
import { createChatTurnStore } from './ai-chat-session-turn-store.js';

export const reconnectTests = (pool: () => DatabasePool, scope: ChatScope) => {
  it('latest_turn_read_restores_request_identity_after_browser_reload', async () => {
    const sessions = createChatSessionStore(pool());
    const session = await sessions.create(scope, randomUUID());
    const turns = createChatTurnStore(pool());
    expect(await turns.get(scope, session.id)).toBeUndefined();
    const requestId = randomUUID();
    await turns.claim(scope, session.id, {
      requestId,
      expectedTranscriptRevision: 0,
      composerRevision: 0,
      text: 'reload-safe',
      attachments: [],
    });
    expect(await turns.get(scope, session.id)).toMatchObject({ requestId, state: 'running' });
    expect(await turns.get({ ...scope, userId: 'another-owner' }, session.id)).toBeUndefined();
  });
};
