import { useLogto } from '@logto/react';
import {
  type LandingPageResponse,
  landingPageDocumentGuard,
  landingPageResponseGuard,
} from '@logto/schemas';
import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { z } from 'zod/v3';

import { cloudApi } from '@/consts';

// Landing page CMS editor API on the admin tenant. Requests carry a Cloud API token with the
// `manage:landing:page` scope; the server rejects anything else.

const landingPageVersionsGuard = z.array(
  z.object({
    version: z.number().int().positive(),
    document: landingPageDocumentGuard,
    publishedBy: z.string(),
    createdAt: z.string(),
  })
);

export type LandingPageVersion = z.infer<typeof landingPageVersionsGuard>[number];

const landingPageChatReplyGuard = z.object({ reply: z.string(), submitted: z.boolean() });

const landingPageBase = '/api/landing-page';

/** The draft save response's publish precondition: the server's draft updated time. */
const landingPageEditorWriteGuard = z.object({ updatedAt: z.string().optional() });

/** A landing page API call failed. `status` carries the HTTP status, e.g. 409 on a publish conflict. */
class LandingPageRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Landing page request failed: ${status}`);
    this.status = status;
  }
}

const request = async (
  getToken: () => Promise<string | undefined>,
  path: string,
  init: { method?: 'GET' | 'PUT' | 'POST'; body?: unknown } = {}
): Promise<unknown> => {
  const token = await getToken();
  const response = await fetch(`${window.location.origin}${landingPageBase}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    throw new LandingPageRequestError(response.status);
  }

  return response.json();
};

export const useLandingPage = () => {
  const { isAuthenticated, getAccessToken } = useLogto();

  const getToken = useCallback(async () => getAccessToken(cloudApi.indicator), [getAccessToken]);

  const { data, error, isLoading, mutate } = useSWR<LandingPageResponse, Error>(
    isAuthenticated ? `${landingPageBase}/editor` : undefined,
    async () => {
      const body = await request(getToken, '/editor');
      return landingPageResponseGuard.parse(body);
    }
  );

  // The editor keeps the draft as loose data while it is being typed; the schema check happens here,
  // so a bad document fails with the validation message instead of reaching the server. Returns the
  // draft's updated time, which the editor then presents when publishing.
  const saveDraft = useCallback(
    async (document: unknown) => {
      const body = await request(getToken, '/draft', {
        method: 'PUT',
        body: landingPageDocumentGuard.parse(document),
      });
      const next = landingPageResponseGuard.parse(body);
      await mutate(next, { revalidate: false });
      // The updated time rides outside the document guard, so the editor can use it as a publish
      // precondition without widening the document schema.
      const { updatedAt } = await landingPageEditorWriteGuard.catch({}).parseAsync(body);
      return { updatedAt };
    },
    [getToken, mutate]
  );

  // Publishes the current draft. When another editor saved in the meantime, the server answers 409
  // and the editor shows the conflict instead of silently publishing their content.
  const publish = useCallback(
    async (expectedUpdatedAt?: string) => {
      const body = await request(getToken, '/publish', {
        method: 'POST',
        body: expectedUpdatedAt ? { expectedUpdatedAt } : undefined,
      });
      await mutate(landingPageResponseGuard.parse(body), { revalidate: false });
    },
    [getToken, mutate]
  );

  const rollback = useCallback(
    async (version: number) => {
      const body = await request(getToken, '/rollback', {
        method: 'POST',
        body: { version },
      });
      await mutate(landingPageResponseGuard.parse(body), { revalidate: false });
    },
    [getToken, mutate]
  );

  const generateEdit = useCallback(
    async (instruction: string, draft: unknown) => {
      const result = z
        .object({ draft: landingPageDocumentGuard })
        .parse(
          await request(getToken, '/ai-edit', { method: 'POST', body: { instruction, draft } })
        );
      return result.draft;
    },
    [getToken]
  );

  const listVersions = useCallback(
    async () => landingPageVersionsGuard.parse(await request(getToken, '/versions')),
    [getToken]
  );

  // Talks to the demo chat the way a visitor would on the site. Messages are sent for real, so a
  // valid lead in the conversation is delivered.
  const sendChat = useCallback(
    async (sessionId: string, message: string) =>
      landingPageChatReplyGuard.parse(
        await request(getToken, '/chat', { method: 'POST', body: { sessionId, message } })
      ),
    [getToken]
  );

  return useMemo(
    () => ({
      data,
      error,
      isLoading,
      saveDraft,
      publish,
      rollback,
      generateEdit,
      listVersions,
      sendChat,
      // Re-reads the editor view, e.g. after a publish conflict shows the newer draft.
      refresh: async () => mutate(),
    }),
    [
      data,
      error,
      isLoading,
      saveDraft,
      publish,
      rollback,
      generateEdit,
      listVersions,
      sendChat,
      mutate,
    ]
  );
};
