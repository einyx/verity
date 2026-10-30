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
  store,
  actions,
  userId,
  tenantId,
  now,
}: {
  instruction: string;
  apiBase: string;
  token: string | undefined;
  store: PendingActionStore;
  actions: Map<string, ProposedActionView>;
  userId: string;
  tenantId: string;
  now: Date;
}): Promise<{ response: string }> => {
  if (!token) {
    return { response: JSON.stringify({ error: 'missing_bearer_token' }) };
  }

  try {
    const draft = await editLandingPageDraft({ instruction, apiBase, token });
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
    return {
      response: JSON.stringify({
        error: 'landing_page_edit_failed',
        message: error instanceof Error ? error.message : 'Landing page edit failed.',
      }),
    };
  }
};
