import RequestError from '#src/errors/RequestError/index.js';

import {
  proposeAndRecordAction,
  type PendingActionStore,
  type ProposedActionView,
} from './ai-chat-actions.js';
import { editLandingPageDraft, saveLandingPageDraftTool } from './ai-chat-landing-page.js';

export const proposeLandingPageEdit = async ({
  instruction,
  apiBase,
  token,
  getToken,
  store,
  actions,
  userId,
  tenantId,
  now,
}: {
  instruction: string;
  apiBase: string;
  token?: string;
  getToken?: () => Promise<string>;
  store: PendingActionStore;
  actions: Map<string, ProposedActionView>;
  userId: string;
  tenantId: string;
  now: Date;
}): Promise<{ response: string }> => {
  try {
    const editorToken = getToken ? await getToken() : token;
    if (!editorToken) {
      return { response: JSON.stringify({ error: 'missing_bearer_token' }) };
    }
    const draft = await editLandingPageDraft({ instruction, apiBase, token: editorToken });
    const response = await proposeAndRecordAction({
      store,
      tool: saveLandingPageDraftTool.name,
      args: { draft },
      actions,
      userId,
      tenantId,
      now,
      note: 'Not saved yet. The user must confirm saving this exact landing-page draft.',
    });

    return { response };
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) {
      return {
        response: JSON.stringify({
          error: 'landing_page_authentication_failed',
          message:
            'The editor credential is missing or invalid. No draft was changed. Refresh the session and retry; do not infer missing editing rights.',
        }),
      };
    }
    return {
      response: JSON.stringify({
        error: 'landing_page_edit_failed',
        message: error instanceof Error ? error.message : 'Landing page edit failed.',
      }),
    };
  }
};
