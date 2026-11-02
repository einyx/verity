import { type CreateTurnInput } from '@logto/schemas';

import { hashTurnInput, normalizeTurnResult } from './ai-chat-session-turn-persistence.js';

const input: CreateTurnInput = {
  requestId: 'f3d60330-6548-43cb-a3bb-d2a62f3a10de',
  expectedTranscriptRevision: 0,
  composerRevision: 1,
  text: 'hello',
  attachments: [{ id: 'file', name: 'a.txt', text: 'hello' }],
};

it('canonical_hash_ignores_object_key_order_but_not_payload_or_revisions', () => {
  expect(
    hashTurnInput({ ...input, attachments: [{ text: 'hello', name: 'a.txt', id: 'file' }] })
  ).toBe(hashTurnInput(input));
  expect(hashTurnInput({ ...input, text: 'hello ' })).not.toBe(hashTurnInput(input));
  expect(hashTurnInput({ ...input, composerRevision: 2 })).not.toBe(hashTurnInput(input));
  expect(hashTurnInput({ ...input, expectedTranscriptRevision: 2 })).not.toBe(hashTurnInput(input));
});

it('oversized_assistant_result_is_a_failed_turn_not_truncated_content', () => {
  expect(normalizeTurnResult({ content: 'a'.repeat(8001), proposalIds: [] })).toMatchObject({
    state: 'failed',
    errorCode: 'content_limit',
    content: null,
  });
  expect(normalizeTurnResult({ content: '🌍'.repeat(4001), proposalIds: [] })).toMatchObject({
    state: 'failed',
    content: null,
  });
  expect(normalizeTurnResult({ content: '🌍'.repeat(4000), proposalIds: [] })).toMatchObject({
    state: 'completed',
  });
});

it('normalizes_duplicate_proposal_ids_and_preserves_failure_codes', () => {
  expect(
    normalizeTurnResult({ content: 'answer', proposalIds: ['first', 'first', 'second'] })
  ).toMatchObject({ proposalIds: ['first', 'second'] });
  expect(normalizeTurnResult({ errorCode: 'ai_chat_unavailable' })).toEqual({
    state: 'failed',
    errorCode: 'ai_chat_unavailable',
    content: null,
    proposalIds: [],
  });
});
