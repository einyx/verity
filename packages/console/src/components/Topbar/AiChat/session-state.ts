import {
  type ChatComposer,
  type ChatMessage,
  type ChatReview,
  type ChatScope,
  type ChatSession,
  type ChatTurn,
  type SessionPage,
} from '@logto/schemas';

import { type SessionApi } from './session-api';
import { readSessionTabs, sessionTabsKey, type SessionTabsState } from './session-tabs';

export type Draft = Pick<ChatComposer, 'text' | 'attachments' | 'revision'>;
export type SessionRecord = {
  session: ChatSession;
  draft: Draft;
  /** Receipt for the exact immutable local payload acknowledged by a composer save. */
  composerSave?: { draft: Draft; revision: number };
  version: number;
  savedVersion: number;
  saveState: 'saved' | 'saving' | 'dirty' | 'failed' | 'conflict';
  conflict?: ChatComposer;
  messages: ChatMessage[];
  messageCursor: SessionPage<ChatMessage>['nextCursor'];
  reviews: ChatReview[];
  hydrated: boolean;
  running: boolean;
  turn?: ChatTurn;
  operation?: boolean;
  requestId?: string;
  error?: string;
};
export type SessionSnapshot = SessionTabsState & {
  records: Record<string, SessionRecord | undefined>;
  history: ChatSession[];
  nextCursor: SessionPage<ChatSession>['nextCursor'];
  emptyDraft: Draft;
  creationConflictId?: string;
  error?: string;
  loading: boolean;
};
export const emptyDraft = (): Draft => ({ text: '', attachments: [], revision: 0 });
export const errorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'ai_chat_unavailable';
export const mergeMessages = (older: ChatMessage[], newer: ChatMessage[]) =>
  [...new Map([...older, ...newer].map((message) => [message.id, message])).values()]
    .slice()
    .sort((left, right) => left.sequence - right.sequence);

export const restoredTurn = (
  current: SessionRecord | undefined,
  turn: Awaited<ReturnType<SessionApi['latestTurn']>>
): Partial<SessionRecord> => {
  if (!turn || (current?.running && current.requestId !== turn.requestId)) {
    return {};
  }
  return {
    turn,
    running: turn.state === 'running',
    requestId: turn.requestId,
    error:
      turn.errorCode ??
      (turn.state === 'interrupted'
        ? 'interrupted'
        : turn.state === 'failed'
          ? 'ai_chat_unavailable'
          : undefined),
  };
};

export class SessionState {
  protected snapshot: SessionSnapshot;
  protected readonly saves = new Map<string, Promise<void>>();
  protected readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  protected disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    protected readonly scope: ChatScope,
    protected api: SessionApi,
    private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>
  ) {
    const tabs = (() => {
      try {
        return readSessionTabs(storage?.getItem(sessionTabsKey(scope)) ?? null);
      } catch {
        return readSessionTabs(null);
      }
    })();
    this.snapshot = {
      ...tabs,
      records: {},
      history: [],
      nextCursor: null,
      emptyDraft: emptyDraft(),
      loading: false,
    };
  }

  getSnapshot = () => this.snapshot;
  get isDisposed() {
    return this.disposed;
  }

  updateApi(api: SessionApi) {
    this.api = api;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.snapshot = {
      records: {},
      history: [],
      nextCursor: null,
      openIds: [],
      activeId: undefined,
      emptyDraft: emptyDraft(),
      loading: false,
    };
    this.listeners.clear();
  }

  protected update(patch: Partial<SessionSnapshot>) {
    if (this.disposed) {
      return;
    }
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  protected record(id: string, patch: Partial<SessionRecord>) {
    const record = this.snapshot.records[id];
    if (record) {
      this.update({ records: { ...this.snapshot.records, [id]: { ...record, ...patch } } });
    }
  }

  protected tabs(tabs: SessionTabsState) {
    this.update(tabs);
    if (!this.disposed) {
      try {
        this.storage?.setItem(sessionTabsKey(this.scope), JSON.stringify(tabs));
      } catch {
        /* Preferences are optional. */
      }
    }
  }
}
