import { z } from 'zod/v3';

import { type PendingAction } from './ai-chat-actions.js';
import { ChatSessionStoreError } from './ai-chat-session-operation.js';
import { validateBody } from './ai-chat-session-proposals.js';

/** Reconstruct registry arguments only to validate. Execution/refresh always uses the stored body. */
export const validateStoredReview = (action: PendingAction) => {
  const { body } = action;
  const args = (() => {
    switch (action.tool) {
      case 'save_landing_page_draft': {
        return { draft: body };
      }
      case 'create_application': {
        const parsed = z
          .object({
            redirectUris: z.array(z.string()),
            postLogoutRedirectUris: z.array(z.string()),
          })
          .strict()
          .safeParse(body.oidcClientMetadata);
        if (!parsed.success) {
          throw new ChatSessionStoreError('revision_conflict');
        }
        return {
          name: body.name,
          type: body.type,
          description: body.description,
          redirect_uris: parsed.data.redirectUris,
          post_logout_redirect_uris: parsed.data.postLogoutRedirectUris,
        };
      }
      case 'create_api_resource': {
        return {
          name: body.name,
          indicator: body.indicator,
          access_token_ttl: body.accessTokenTtl,
        };
      }
      case 'create_organization': {
        return { name: body.name, description: body.description };
      }
      default: {
        throw new ChatSessionStoreError('revision_conflict');
      }
    }
  })();
  validateBody(action, args);
};
