import { chatSearchGuard } from '@logto/schemas';

import {
  SessionState,
  emptyDraft,
  errorCode,
  mergeMessages,
  restoredTurn,
  type SessionRecord,
} from './session-state';
import { closeSessionTab } from './session-tabs';

const pristineRecord = (record: SessionRecord) =>
  record.hydrated &&
  !record.session.archivedAt &&
  record.version === 0 &&
  record.draft.revision === 0 &&
  record.draft.text.length === 0 &&
  record.draft.attachments.length === 0 &&
  record.messages.length === 0 &&
  record.reviews.length === 0 &&
  !record.running &&
  !record.operation &&
  record.saveState === 'saved';

export class SessionHistory extends SessionState {
  private readonly loads = new Map<string, Promise<void>>();
  private creationId = crypto.randomUUID();
  private creation?: Promise<string | undefined>;
  private recoveryFor?: string;
  private historyEpoch = 0;
  private historyFilter = { archived: false, search: '' };

  async list(
    archived = this.historyFilter.archived,
    search = this.historyFilter.search,
    more = false
  ) {
    if (this.disposed) {
      return;
    }
    if (!chatSearchGuard.safeParse(search).success) {
      this.update({ error: 'content_limit' });
      return;
    }
    this.historyFilter = { archived, search };
    this.historyEpoch += 1;
    const epoch = this.historyEpoch;
    this.update({ loading: true, error: undefined });
    try {
      const page = await this.api.list({
        archived,
        search,
        ...(more && this.snapshot.nextCursor ? { cursor: this.snapshot.nextCursor } : {}),
      });
      if (epoch !== this.historyEpoch) {
        return;
      }
      this.update({
        history: more
          ? [
              ...new Map(
                [...this.snapshot.history, ...page.items].map((item) => [item.id, item])
              ).values(),
            ]
          : page.items,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      this.update({ error: errorCode(error) });
    } finally {
      if (epoch === this.historyEpoch) {
        this.update({ loading: false });
      }
    }
  }

  async openSession(id: string) {
    if (this.disposed) {
      return;
    }
    this.tabs({ openIds: [...new Set([...this.snapshot.openIds, id])], activeId: id });
    await this.refresh(id);
  }

  selectSession(id: string) {
    void this.openSession(id);
  }

  async refresh(id: string, fresh = false): Promise<void> {
    if (this.disposed) {
      return;
    }
    const existing = this.loads.get(id);
    if (existing) {
      if (fresh) {
        await existing;
        await this.refresh(id);
        return;
      }
      return existing;
    }
    const load = this.load(id);
    this.loads.set(id, load);
    try {
      await load;
    } finally {
      this.loads.delete(id);
    }
  }

  async older(id: string) {
    const record = this.snapshot.records[id];
    if (!record?.messageCursor) {
      return;
    }
    try {
      const page = await this.api.messages(id, record.messageCursor);
      const current = this.snapshot.records[id];
      if (!current) {
        return;
      }
      this.record(id, {
        messages: mergeMessages(page.items, current.messages),
        messageCursor: page.nextCursor,
      });
    } catch (error) {
      this.record(id, { error: errorCode(error) });
    }
  }

  async newSession() {
    if (this.disposed || this.snapshot.creationConflictId) {
      return;
    }
    if (this.creation) {
      return this.creation;
    }
    const previousActive = this.snapshot.activeId;
    const create = (async () => {
      try {
        const session = await this.api.create(this.creationId);
        if (this.disposed) {
          return;
        }
        // Create is idempotent: its result may already have history, reviews or a remote draft.
        // Never mark a synthetic empty record hydrated without reading those authorities.
        if (!this.snapshot.records[session.id]) {
          await this.refresh(session.id);
        }
        if (this.isDisposed) {
          return;
        }
        const existing = this.snapshot.records[session.id];
        if (!existing) {
          return;
        }
        const draft = this.snapshot.emptyDraft;
        const hasUnbound = draft.text.length > 0 || draft.attachments.length > 0;
        const sameContent =
          draft.text === existing.draft.text &&
          JSON.stringify(draft.attachments.map(({ id, name, text }) => [id, name, text])) ===
            JSON.stringify(
              existing.draft.attachments.map(({ id, name, text }) => [id, name, text])
            );
        const pristine = pristineRecord(existing) && draft.revision === existing.draft.revision;
        if (hasUnbound && !sameContent && !pristine) {
          // A lost creation response may resolve to a conversation already opened and edited.
          // Preserve both local drafts; the caller must not flush the stale unbound one over it.
          this.update({ creationConflictId: session.id, error: undefined });
          return;
        }
        const record: SessionRecord =
          hasUnbound && !sameContent && pristine
            ? {
                ...existing,
                // Pristine adoption has the same revision. Keep immutable click-time ownership.
                draft,
                version: existing.version + 1,
                saveState: 'dirty',
              }
            : existing;
        this.update({
          records: {
            ...this.snapshot.records,
            [session.id]: record,
          },
          emptyDraft: emptyDraft(),
          history: [
            record.session,
            ...this.snapshot.history.filter((item) => item.id !== session.id),
          ],
          error: undefined,
        });
        this.tabs({
          openIds: [...new Set([...this.snapshot.openIds, session.id])],
          activeId: this.snapshot.activeId === previousActive ? session.id : this.snapshot.activeId,
        });
        this.creationId = crypto.randomUUID();
        return session.id;
      } catch (error) {
        this.update({ error: errorCode(error) });
      }
    })();
    this.creation = create;
    try {
      return await create;
    } finally {
      this.creation = undefined;
    }
  }

  /** Explicitly keep both drafts, with one stable new identity across transport retries. */
  async recoverCreation() {
    const conflictId = this.snapshot.creationConflictId;
    if (this.disposed || Boolean(this.creation) || !conflictId) {
      return;
    }
    if (this.recoveryFor !== conflictId) {
      this.creationId = crypto.randomUUID();
      this.recoveryFor = conflictId;
    }
    this.update({ creationConflictId: undefined, error: undefined });
    const id = await this.newSession();
    if (!id && !this.snapshot.creationConflictId) {
      this.update({ creationConflictId: conflictId });
    } else if (id) {
      this.recoveryFor = undefined;
    }
    return id;
  }

  private async load(id: string) {
    const version = this.snapshot.records[id]?.version;
    this.record(id, { hydrated: false });
    try {
      const [session, draft, page, reviews, turn] = await Promise.all([
        this.api.get(id),
        this.api.composer(id),
        this.api.messages(id),
        this.api.reviews(id),
        this.api.latestTurn(id),
      ]);
      if (this.disposed) {
        return;
      }
      const current = this.snapshot.records[id];
      const dirty =
        current &&
        (current.version !== current.savedVersion ||
          current.saveState !== 'saved' ||
          version !== current.version);
      const olderComposer = current && draft.revision < current.draft.revision;
      this.update({
        records: {
          ...this.snapshot.records,
          [id]: {
            version: 0,
            savedVersion: 0,
            saveState: 'saved',
            running: false,
            ...current,
            ...restoredTurn(current, turn),
            session:
              current && session.revision < current.session.revision ? current.session : session,
            draft: current && (Boolean(dirty) || Boolean(olderComposer)) ? current.draft : draft,
            messages: mergeMessages(current?.messages ?? [], page.items),
            reviews,
            hydrated: true,
            messageCursor: current?.messageCursor ?? page.nextCursor,
            ...(dirty && draft.revision > current.draft.revision && !this.saves.has(id)
              ? { conflict: draft, saveState: 'conflict' }
              : {}),
          },
        },
      });
    } catch (error) {
      this.record(id, { error: errorCode(error), hydrated: false });
      this.update({ error: errorCode(error) });
      if (errorCode(error) === 'not_found') {
        this.tabs(closeSessionTab(this.snapshot, id));
        this.update({
          records: Object.fromEntries(
            Object.entries(this.snapshot.records).filter(([key]) => key !== id)
          ),
        });
      }
    }
  }
}
