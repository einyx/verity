import { describe, expect, it } from 'vitest';

import {
  chatComposerGuard,
  chatMessageCursorGuard,
  chatMessageGuard,
  chatReviewGuard,
  chatSearchGuard,
  chatSessionCursorGuard,
  chatSessionErrorGuard,
  chatSessionGuard,
  chatTurnGuard,
  createSessionInputGuard,
  createTurnInputGuard,
  serializeChatInput,
  sessionPageGuard,
  updateComposerInputGuard,
  updateSessionInputGuard,
  validateChatInput,
} from './ai-chat-sessions.js';

const requestId = '4eac37f3-1557-4c7a-b795-4ab4c583aa8b';
const attachment = { id: 'file', name: 'notes.txt', text: 'notes' };

describe('persistent chat contract', () => {
  it('rejects_oversize_send_without_truncation', () => {
    const input = { text: 'a'.repeat(8001), attachments: [] };
    expect(validateChatInput({ ...input, text: 'a'.repeat(8000) })).toEqual({
      ok: true,
      content: 'a'.repeat(8000),
    });
    expect(validateChatInput(input)).toEqual({ ok: false, error: 'content_limit' });
    expect(input.text).toHaveLength(8001);
    expect(validateChatInput({ text: '  ', attachments: [] }).ok).toBe(false);
    expect(serializeChatInput({ text: ' question ', attachments: [attachment] })).toBe(
      'File: notes.txt\n```\nnotes\n```\n\nquestion'
    );
    expect(validateChatInput({ text: '', attachments: [attachment] }).ok).toBe(true);
  });

  it('counts_multibyte_attachments_as_utf8', () => {
    const parse = (text: string) =>
      updateComposerInputGuard.safeParse({
        expectedRevision: 0,
        text: '',
        attachments: [{ ...attachment, text }],
      }).success;
    expect(parse('a'.repeat(100 * 1024))).toBe(true);
    expect(parse('a'.repeat(100 * 1024 + 1))).toBe(false);
    expect(parse('é'.repeat(50 * 1024))).toBe(true);
    expect(parse('é'.repeat(50 * 1024) + 'a')).toBe(false);
    expect(validateChatInput({ text: '界'.repeat(8000), attachments: [] }).ok).toBe(true);
    expect(
      validateChatInput({ text: '', attachments: [{ ...attachment, text: 'a'.repeat(8000) }] }).ok
    ).toBe(false);
    const sixFiles = Array.from({ length: 6 }, (_, index) => ({
      ...attachment,
      id: String(index),
    }));
    expect(validateChatInput({ text: '', attachments: sixFiles }).ok).toBe(false);
    expect(
      updateComposerInputGuard.safeParse({
        expectedRevision: 0,
        text: 'é'.repeat(256 * 1024 + 1),
        attachments: [],
      }).success
    ).toBe(false);
  });

  it('validates_public_inputs_and_composer_boundaries', () => {
    const composer = { expectedRevision: 0, text: '', attachments: [attachment] };
    const turn = {
      requestId,
      expectedTranscriptRevision: 0,
      composerRevision: 0,
      text: 'hello',
      attachments: [],
    };
    expect(createTurnInputGuard.safeParse(turn).success).toBe(true);
    expect(updateComposerInputGuard.safeParse(composer).success).toBe(true);
    expect(
      updateComposerInputGuard.safeParse({ ...composer, text: 'a'.repeat(512 * 1024) }).success
    ).toBe(false);
    expect(
      updateComposerInputGuard.safeParse({
        ...composer,
        attachments: [],
        text: 'a'.repeat(512 * 1024),
      }).success
    ).toBe(true);
    for (const ownership of [{ userId: 'other' }, { tenantId: 'other' }]) {
      expect(updateComposerInputGuard.safeParse({ ...composer, ...ownership }).success).toBe(false);
      expect(createTurnInputGuard.safeParse({ ...turn, ...ownership }).success).toBe(false);
      expect(
        updateSessionInputGuard.safeParse({ expectedRevision: 0, archived: true, ...ownership })
          .success
      ).toBe(false);
    }
    expect(chatSearchGuard.safeParse('😀'.repeat(120)).success).toBe(true);
    expect(chatSearchGuard.safeParse('😀'.repeat(121)).success).toBe(false);
  });

  it('parses_explicit_response_states_without_leaking_internal_fields', () => {
    const timestamp = '2026-11-01T00:00:00.000Z';
    const session = {
      id: 'session',
      title: 'Session',
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 0,
      transcriptRevision: 0,
    };
    const turn = {
      id: 'turn',
      requestId,
      state: 'running',
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      messageIds: [],
    };
    expect(chatSessionGuard.safeParse(session).success).toBe(true);
    expect(
      sessionPageGuard(chatSessionGuard).parse({ items: [session], nextCursor: null }).items
    ).toEqual([session]);
    expect(
      chatComposerGuard.safeParse({ revision: 0, text: '', attachments: [], updatedAt: timestamp })
        .success
    ).toBe(true);
    for (const state of ['running', 'completed', 'failed', 'interrupted']) {
      expect(chatTurnGuard.safeParse({ ...turn, state }).success).toBe(true);
    }
    expect(chatTurnGuard.safeParse({ ...turn, leaseToken: 'secret' }).success).toBe(false);
    const message = {
      id: 'message',
      sequence: 1,
      turnId: 'turn',
      role: 'assistant',
      content: 'hello',
      createdAt: timestamp,
      reviews: [],
    };
    expect(chatMessageGuard.safeParse(message).success).toBe(true);
    expect(chatMessageGuard.safeParse({ ...message, content: 'a'.repeat(8001) }).success).toBe(
      false
    );
    expect(chatMessageGuard.safeParse({ ...message, role: 'tool' }).success).toBe(false);
    expect(
      chatSessionErrorGuard.safeParse({ error: 'revision_conflict', currentRevision: 1 }).success
    ).toBe(true);
    expect(chatSessionErrorGuard.safeParse({ error: 'unknown' }).success).toBe(false);
    expect(chatMessageCursorGuard.safeParse('WzFd').success).toBe(true);
    expect(chatMessageCursorGuard.safeParse('Wy0xXQ').success).toBe(false);
    expect(chatMessageCursorGuard.safeParse('WzFd=').success).toBe(false);
  });

  it('validates_revisions_cursors_and_server_response_states', () => {
    expect(createSessionInputGuard.safeParse({ requestId }).success).toBe(true);
    expect(createSessionInputGuard.safeParse({ requestId: 'not-uuid' }).success).toBe(false);
    expect(createSessionInputGuard.safeParse({ requestId, userId: 'other' }).success).toBe(false);
    for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(updateSessionInputGuard.safeParse({ expectedRevision, title: 'title' }).success).toBe(
        false
      );
    }
    expect(
      updateSessionInputGuard.safeParse({ expectedRevision: 0, title: '😀'.repeat(120) }).success
    ).toBe(true);
    expect(
      updateSessionInputGuard.safeParse({ expectedRevision: 0, title: '😀'.repeat(121) }).success
    ).toBe(false);
    expect(updateSessionInputGuard.safeParse({ expectedRevision: 0 }).success).toBe(false);
    expect(chatSessionCursorGuard.safeParse('SELECT * FROM sessions').success).toBe(false);
    expect(chatSessionCursorGuard.safeParse('YWJj').success).toBe(false);
    expect(
      chatSessionCursorGuard.safeParse(
        globalThis
          .btoa(JSON.stringify(['2026-11-01T00:00:00.000Z', 'session']))
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replace(/=+$/u, '')
      ).success
    ).toBe(true);
    const review = {
      originalActionId: 'original',
      currentActionId: 'current',
      tool: 'create_application',
      body: { name: 'Example' },
      expiresAt: '2026-11-01T00:00:00.000Z',
      isError: null,
    };
    expect(chatReviewGuard.safeParse(review).success).toBe(false);
    expect(chatReviewGuard.safeParse({ ...review, state: 'replaced' }).success).toBe(false);
    expect(chatReviewGuard.safeParse({ ...review, state: 'pending' }).success).toBe(true);
    expect(
      chatReviewGuard.safeParse({ ...review, state: 'pending', result: { token: 'secret' } })
        .success
    ).toBe(false);
    expect(chatTurnGuard.safeParse({ state: 'pending' }).success).toBe(false);
    expect(chatComposerGuard.safeParse({ revision: -1 }).success).toBe(false);
    expect(
      createTurnInputGuard.safeParse({
        requestId,
        expectedTranscriptRevision: 0,
        composerRevision: 0,
        text: 'a'.repeat(8001),
        attachments: [],
      }).success
    ).toBe(false);
  });
});
