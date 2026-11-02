import { type ChatComposer, type ChatSession } from '@logto/schemas';

import { type SessionApi } from './session-api';
import { SessionController } from './session-controller';

export const timestamp = '2026-11-01T00:00:00.000Z';
export const session = (id: string): ChatSession => ({
  id,
  title: 'New conversation',
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  revision: 0,
  transcriptRevision: 0,
});
export const composer = (text = '', revision = 0): ChatComposer => ({
  text,
  revision,
  attachments: [],
  updatedAt: timestamp,
});
export const deferred = <T>() => {
  const release = jest.fn<void, [T]>();
  const fail = jest.fn<void, [Error]>();
  const promise = new Promise<T>((resolve, reject) => {
    release.mockImplementation(resolve);
    fail.mockImplementation(reject);
  });
  return { promise, resolve: release, reject: fail };
};
export const fakeApi = () =>
  ({
    create: jest.fn(async () => session('one')),
    list: jest.fn(async () => ({ items: [session('one'), session('two')], nextCursor: null })),
    get: jest.fn(async (id: string) => session(id)),
    messages: jest.fn<ReturnType<SessionApi['messages']>, [string, string?]>(async () => ({
      items: [],
      nextCursor: null,
    })),
    reviews: jest.fn<ReturnType<SessionApi['reviews']>, [string]>(async () => []),
    composer: jest.fn<ReturnType<SessionApi['composer']>, Parameters<SessionApi['composer']>>(
      async () => composer()
    ),
    saveComposer: jest.fn<
      ReturnType<SessionApi['saveComposer']>,
      Parameters<SessionApi['saveComposer']>
    >(async (_id, input) => ({
      ...composer(input.text, input.expectedRevision + 1),
      attachments: input.attachments,
    })),
    update: jest.fn(async (id: string) => session(id)),
    remove: jest.fn<Promise<void>, [string, number]>(),
    turn: jest.fn(),
    getTurn: jest.fn(),
    latestTurn: jest.fn<ReturnType<SessionApi['latestTurn']>, [string]>(async () => null),
    refreshReview: jest.fn(),
    confirm: jest.fn(),
    cancel: jest.fn(),
  }) satisfies SessionApi;
export const setup = () => {
  const api = fakeApi();
  const storage = { getItem: jest.fn(() => null), setItem: jest.fn() };
  const controller = new SessionController({ tenantId: 'tenant', userId: 'owner' }, api, storage);
  return { api, controller, storage };
};
