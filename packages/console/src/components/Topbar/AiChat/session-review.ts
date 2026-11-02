import { type ChatReview } from '@logto/schemas';

import { type ProposedAction } from './ProposedActionCard';

export const reviewAction = (review: ChatReview): ProposedAction => ({
  id: review.currentActionId,
  tool: review.tool,
  body: review.body,
  expiresAt: review.expiresAt,
  status:
    review.state === 'executed'
      ? review.isError
        ? 'failed'
        : 'done'
      : review.state === 'cancelled'
        ? 'cancelled'
        : review.state === 'confirmed'
          ? 'running'
          : 'pending',
});
