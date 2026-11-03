import { chatLandingReviewTtlMs } from '@logto/schemas';

import RequestError from '#src/errors/RequestError/index.js';

import { editLandingPageDraft } from './ai-chat-landing-page.js';

/** Deliberately has no proposal store or write executor. Nothing returned here is confirmable. */
export const reviewLandingPage = async ({
  instruction,
  apiBase,
  getToken,
  fetchImpl,
}: {
  instruction: string;
  apiBase: string;
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}) => {
  const token = await getToken();
  const draft = await editLandingPageDraft({
    instruction,
    apiBase,
    token,
    fetchImpl: async (...args) => {
      const response = await (fetchImpl ?? fetch)(...args);
      if (response.status === 401 || response.status === 403) {
        throw new RequestError({ code: response.status === 401 ? 'auth.unauthorized' : 'auth.forbidden', status: response.status });
      }
      return response;
    },
  });
  return { draft, expiresAt: new Date(Date.now() + chatLandingReviewTtlMs).toISOString() };
};
