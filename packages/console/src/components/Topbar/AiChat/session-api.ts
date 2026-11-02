import {
  chatComposerGuard,
  chatMessageGuard,
  chatReviewGuard,
  chatSessionGuard,
  chatSessionErrorGuard,
  chatTurnGuard,
  sessionPageGuard,
  type CreateTurnInput,
  type UpdateComposerInput,
  type UpdateSessionInput,
} from '@logto/schemas';
import { type KyInstance } from 'ky';
import { z } from 'zod/v3';

export class SessionApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly currentRevision?: number
  ) {
    super(code);
  }
}

const parse = async <T>(request: PromiseLike<Response>, guard: z.ZodType<T>): Promise<T> => {
  const response = await request;
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = chatSessionErrorGuard.safeParse(body);
    throw new SessionApiError(
      error.success ? error.data.error : 'ai_chat_unavailable',
      error.success ? error.data.currentRevision : undefined
    );
  }
  return guard.parse(body);
};

/** All ownership is supplied by the authenticated API, never by client JSON. */
export function createSessionApi(
  api: KyInstance,
  landingHeaders: () => Promise<Record<string, string>>
) {
  const root = 'api/ai-chat/sessions';
  const path = (id: string) => `${root}/${encodeURIComponent(id)}`;
  const options = { retry: 0, throwHttpErrors: false } as const;
  return {
    create: async (requestId: string) =>
      parse(api.post(root, { ...options, json: { requestId } }), chatSessionGuard),
    list: async (query: { archived: boolean; search?: string; cursor?: string }) =>
      parse(api.get(root, { ...options, searchParams: query }), sessionPageGuard(chatSessionGuard)),
    get: async (id: string) => parse(api.get(path(id), options), chatSessionGuard),
    messages: async (id: string, cursor?: string) =>
      parse(
        api.get(`${path(id)}/messages`, { ...options, searchParams: cursor ? { cursor } : {} }),
        sessionPageGuard(chatMessageGuard)
      ),
    reviews: async (id: string) =>
      parse(api.get(`${path(id)}/reviews`, options), chatReviewGuard.array()),
    composer: async (id: string) =>
      parse(api.get(`${path(id)}/composer`, options), chatComposerGuard),
    saveComposer: async (id: string, input: UpdateComposerInput) =>
      parse(api.put(`${path(id)}/composer`, { ...options, json: input }), chatComposerGuard),
    update: async (id: string, input: UpdateSessionInput) =>
      parse(api.patch(path(id), { ...options, json: input }), chatSessionGuard),
    remove: async (id: string, expectedRevision: number) => {
      const response = await api.delete(path(id), {
        ...options,
        searchParams: { expectedRevision },
      });
      if (!response.ok) {
        const error = chatSessionErrorGuard.safeParse(await response.json());
        throw new SessionApiError(error.success ? error.data.error : 'ai_chat_unavailable');
      }
    },
    turn: async (id: string, input: CreateTurnInput) =>
      parse(
        api.post(`${path(id)}/turns`, {
          ...options,
          timeout: 180_000,
          headers: await landingHeaders(),
          json: input,
        }),
        chatTurnGuard
      ),
    getTurn: async (id: string, requestId: string) =>
      parse(api.get(`${path(id)}/turns/${encodeURIComponent(requestId)}`, options), chatTurnGuard),
    latestTurn: async (id: string) => {
      const response = await parse(
        api.get(`${path(id)}/turns`, options),
        z.object({ turn: chatTurnGuard.nullable() })
      );
      return response.turn;
    },
    refreshReview: async (id: string, originalId: string, expectedActionId: string) =>
      parse(
        api.post(`${path(id)}/reviews/${encodeURIComponent(originalId)}/refresh`, {
          ...options,
          headers: await landingHeaders(),
          json: { expectedActionId },
        }),
        chatReviewGuard
      ),
    confirm: async (id: string) =>
      api
        .post(`api/ai-chat/actions/${encodeURIComponent(id)}/confirm`, {
          retry: 0,
          headers: await landingHeaders(),
        })
        .json<unknown>(),
    cancel: async (id: string) =>
      api
        .post(`api/ai-chat/actions/${encodeURIComponent(id)}/cancel`, { retry: 0 })
        .json<unknown>(),
  };
}

export type SessionApi = ReturnType<typeof createSessionApi>;
