import { landingPageDocumentGuard } from '@logto/schemas';
import { z } from 'zod/v3';

import { type ProposedAction } from './ProposedActionCard';

const refreshedReviewGuard = z.object({
  id: z.string().min(1),
  tool: z.literal('save_landing_page_draft'),
  body: landingPageDocumentGuard,
  expiresAt: z.string().datetime(),
});

/** Reopens the exact draft for review. This endpoint creates a proposal, never saves/publishes it. */
export const refreshDraftReview = async (
  action: Pick<ProposedAction, 'id' | 'tool' | 'body'>,
  propose: (request: { tool: string; arguments: { draft: unknown } }) => Promise<unknown>
): Promise<ProposedAction> => {
  if (action.tool !== 'save_landing_page_draft') {
    throw new Error('Only landing draft reviews can be refreshed here.');
  }
  const draft = landingPageDocumentGuard.parse(action.body);
  const renewed = refreshedReviewGuard.parse(
    await propose({ tool: action.tool, arguments: { draft } })
  );
  if (renewed.id === action.id || JSON.stringify(renewed.body) !== JSON.stringify(draft)) {
    throw new Error('The refreshed review did not preserve the proposed draft.');
  }
  return { ...renewed, status: 'pending' };
};
