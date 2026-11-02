import { updateComposerInputGuard } from '@logto/schemas';

import { SessionHistory } from './session-history';
import { errorCode, type Draft } from './session-state';

export class SessionComposer extends SessionHistory {
  setText(text: string) {
    const draft =
      this.snapshot.records[this.snapshot.activeId ?? '']?.draft ?? this.snapshot.emptyDraft;
    this.edit({ ...draft, text });
  }

  addAttachments(attachments: Draft['attachments'], sessionId = this.snapshot.activeId) {
    const draft = this.snapshot.records[sessionId ?? '']?.draft ?? this.snapshot.emptyDraft;
    const next = { ...draft, attachments: [...draft.attachments, ...attachments] };
    if (
      !updateComposerInputGuard.safeParse({
        expectedRevision: draft.revision,
        text: next.text,
        attachments: next.attachments,
      }).success
    ) {
      this.update({ error: 'content_limit' });
      return;
    }
    this.edit(next, sessionId);
  }

  removeAttachment(id: string) {
    const draft =
      this.snapshot.records[this.snapshot.activeId ?? '']?.draft ?? this.snapshot.emptyDraft;
    this.edit({ ...draft, attachments: draft.attachments.filter((item) => item.id !== id) });
  }

  async flush(sessionId = this.snapshot.activeId): Promise<void> {
    clearTimeout(this.timers.get(sessionId ?? ''));
    const id =
      sessionId ??
      (Boolean(this.snapshot.emptyDraft.text.trim()) ||
      this.snapshot.emptyDraft.attachments.length > 0
        ? await this.newSession()
        : undefined);
    if (!id || this.disposed) {
      return;
    }
    clearTimeout(this.timers.get(id));
    const previous = this.saves.get(id);
    if (previous) {
      await previous;
      return this.flush(id);
    }
    const record = this.snapshot.records[id];
    if (
      !record ||
      Boolean(record.conflict) ||
      Boolean(record.session.archivedAt) ||
      record.version === record.savedVersion
    ) {
      return;
    }
    const save = (async () => {
      this.record(id, { saveState: 'saving' });
      try {
        const saved = await this.api.saveComposer(id, {
          expectedRevision: record.draft.revision,
          text: record.draft.text,
          attachments: record.draft.attachments,
        });
        const current = this.snapshot.records[id];
        if (!current) {
          return;
        }
        this.record(id, {
          draft: { ...current.draft, revision: saved.revision },
          composerSave: { draft: record.draft, revision: saved.revision },
          savedVersion: record.version,
          saveState: current.version === record.version ? 'saved' : 'dirty',
        });
        await this.deriveTitle(id, record.draft.text);
      } catch (error) {
        this.record(id, { saveState: 'failed', error: errorCode(error) });
        if (errorCode(error) === 'revision_conflict') {
          try {
            const conflict = await this.api.composer(id);
            this.record(id, { conflict, saveState: 'conflict' });
          } catch {
            /* Keep failed draft. */
          }
        }
      }
    })();
    this.saves.set(id, save);
    try {
      await save;
    } finally {
      this.saves.delete(id);
    }
  }

  async resolveConflict(id: string, choice: 'load' | 'replace') {
    const record = this.snapshot.records[id];
    if (!record?.conflict) {
      return;
    }
    this.record(id, {
      draft:
        choice === 'load'
          ? record.conflict
          : { ...record.draft, revision: record.conflict.revision },
      conflict: undefined,
      savedVersion: choice === 'load' ? record.version : record.savedVersion,
      saveState: choice === 'load' ? 'saved' : 'dirty',
    });
    if (choice === 'replace') {
      await this.flush(id);
    }
  }

  private edit(draft: Draft, id = this.snapshot.activeId) {
    if (this.disposed) {
      return;
    }
    if (id) {
      const record = this.snapshot.records[id];
      if (!record || record.session.archivedAt) {
        return;
      }
      this.record(id, {
        draft,
        version: record.version + 1,
        saveState: record.conflict ? 'conflict' : 'dirty',
      });
    } else {
      this.update({ emptyDraft: draft });
      if (Boolean(draft.text.trim()) || draft.attachments.length > 0) {
        void (async () => {
          const created = await this.newSession();
          if (created) {
            this.scheduleSave(created);
          }
        })();
      }
      return;
    }
    this.scheduleSave(id);
  }

  private scheduleSave(id: string) {
    if (this.disposed) {
      return;
    }
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.flush(id);
      }, 600)
    );
  }

  private async deriveTitle(id: string, text: string) {
    const record = this.snapshot.records[id];
    if (this.disposed || !record || record.session.revision !== 0 || !text.trim()) {
      return;
    }
    try {
      const session = await this.api.update(id, {
        expectedRevision: 0,
        title: [...text.trim()].slice(0, 120).join(''),
      });
      this.record(id, { session });
      this.update({
        history: this.snapshot.history.map((item) => (item.id === id ? session : item)),
      });
    } catch {
      /* A concurrent explicit rename wins; composer persistence already succeeded. */
    }
  }
}
