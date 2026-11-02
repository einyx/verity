import { type UpdateSessionInput, chatTitleGuard, validateChatInput } from '@logto/schemas';

import { SessionApiError } from './session-api';
import { SessionComposer } from './session-composer';
import { errorCode } from './session-state';
import { closeSessionTab } from './session-tabs';

/** Account-local controller; a completion always belongs to its initiating session. */
export class SessionController extends SessionComposer {
  async reviewOperation<T>(id: string, execute: () => Promise<T>): Promise<T> {
    const record = this.snapshot.records[id];
    if (
      this.disposed ||
      !record?.hydrated ||
      Boolean(record.session.archivedAt) ||
      record.running ||
      Boolean(record.operation)
    ) {
      throw new SessionApiError('session_busy');
    }
    this.record(id, { operation: true });
    try {
      return await execute();
    } finally {
      await this.refresh(id, true);
      this.record(id, { operation: false });
    }
  }

  closeTab(id: string) {
    this.tabs(closeSessionTab(this.snapshot, id));
    if (this.snapshot.records[id]?.saveState === 'dirty') {
      void this.flush(id);
    }
  }

  async change(id: string, input: Omit<UpdateSessionInput, 'expectedRevision'>) {
    const record = this.snapshot.records[id];
    if (
      !record ||
      record.running ||
      Boolean(record.operation) ||
      (input.title !== undefined && !chatTitleGuard.safeParse(input.title).success)
    ) {
      return;
    }
    try {
      await this.flush(id);
      if (input.archived !== false && this.snapshot.records[id]?.saveState !== 'saved') {
        return;
      }
      const session = await this.api.update(id, {
        ...input,
        expectedRevision: this.snapshot.records[id]?.session.revision ?? record.session.revision,
      });
      this.record(id, { session });
      if (input.archived) {
        this.closeTab(id);
      }
      await this.list();
    } catch (error) {
      this.record(id, { error: errorCode(error) });
      this.update({ error: errorCode(error) });
    }
  }

  async remove(id: string) {
    const record = this.snapshot.records[id];
    if (!record || record.running || record.operation) {
      return;
    }
    try {
      await this.api.remove(id, record.session.revision);
      if (this.disposed) {
        return;
      }
      clearTimeout(this.timers.get(id));
      this.tabs(closeSessionTab(this.snapshot, id));
      this.update({
        records: Object.fromEntries(
          Object.entries(this.snapshot.records).filter(([key]) => key !== id)
        ),
        history: this.snapshot.history.filter((item) => item.id !== id),
      });
    } catch (error) {
      this.update({ error: errorCode(error) });
    }
  }

  async send(text?: string) {
    if (this.disposed) {
      return;
    }
    if (text !== undefined) {
      this.setText(text);
    }
    const { activeId } = this.snapshot;
    const origin = this.snapshot.records[activeId ?? ''];
    const draft = origin?.draft ?? this.snapshot.emptyDraft;
    if (
      origin &&
      [
        origin.running,
        origin.operation,
        Boolean(origin.session.archivedAt),
        Boolean(origin.conflict),
      ].some(Boolean)
    ) {
      return;
    }
    if (!validateChatInput({ text: draft.text, attachments: draft.attachments }).ok) {
      this.update({ error: 'content_limit' });
      return;
    }
    const id = activeId ?? (await this.newSession());
    if (!id) {
      return;
    }
    const prepared = this.snapshot.records[id];
    if (!prepared) {
      return;
    }
    const intendedVersion = origin?.version ?? (prepared.draft === draft ? prepared.version : -1);
    await this.flush(id);
    const record = this.snapshot.records[id];
    if (!record) {
      return;
    }
    if (
      [
        record.running,
        record.operation,
        Boolean(record.session.archivedAt),
        Boolean(record.conflict),
        record.saveState === 'failed',
        record.savedVersion < intendedVersion,
      ].some(Boolean)
    ) {
      return;
    }
    // Use only the acknowledgement for this exact clicked payload, never a later remote revision.
    const composerRevision =
      record.composerSave?.draft === draft ? record.composerSave.revision : draft.revision;
    const requestId = crypto.randomUUID();
    this.record(id, { running: true, requestId, error: undefined });
    try {
      const turn = await this.api.turn(id, {
        requestId,
        expectedTranscriptRevision:
          origin?.session.transcriptRevision ?? prepared.session.transcriptRevision,
        composerRevision,
        text: draft.text,
        attachments: draft.attachments,
      });
      if (!this.ownsRequest(id, requestId)) {
        return;
      }
      this.record(id, {
        turn,
        running: turn.state === 'running',
        error: turn.errorCode ?? undefined,
      });
    } catch (error) {
      await this.reconnect(id, requestId, error);
    }
    await this.refresh(id, true);
  }

  async poll() {
    await Promise.all(
      Object.entries(this.snapshot.records).map(async ([id, record]) => {
        if (!record?.running || !record.requestId) {
          return;
        }
        try {
          const turn = await this.api.getTurn(id, record.requestId);
          if (!this.ownsRequest(id, record.requestId)) {
            return;
          }
          this.record(id, {
            turn,
            running: turn.state === 'running',
            error: turn.errorCode ?? undefined,
          });
          await this.refresh(id);
        } catch (error) {
          if (this.ownsRequest(id, record.requestId)) {
            this.record(id, { error: errorCode(error) });
          }
        }
      })
    );
  }

  prepareRetry(id: string) {
    const record = this.snapshot.records[id];
    if (
      this.disposed ||
      this.snapshot.activeId !== id ||
      !record ||
      record.running ||
      Boolean(record.operation) ||
      record.draft.text.length > 0 ||
      record.draft.attachments.length > 0 ||
      !record.turn ||
      !['failed', 'interrupted'].includes(record.turn.state)
    ) {
      return;
    }
    const message = record.messages.find(
      (item) => item.role === 'user' && item.turnId === record.turn?.id
    );
    if (message) {
      this.setText(message.content);
    }
  }

  private ownsRequest(id: string, requestId: string) {
    return this.snapshot.records[id]?.requestId === requestId;
  }

  private async reconnect(id: string, requestId: string, error: unknown) {
    if (!this.ownsRequest(id, requestId)) {
      return;
    }
    // A lost response is not permission to replay. Status reads are the only automatic recovery.
    this.record(id, { error: errorCode(error) });
    try {
      const turn = await this.api.getTurn(id, requestId);
      if (!this.ownsRequest(id, requestId)) {
        return;
      }
      this.record(id, { turn, running: turn.state === 'running' });
    } catch (readError) {
      if (this.ownsRequest(id, requestId)) {
        this.record(id, { running: false, error: errorCode(readError) });
      }
    }
  }
}
