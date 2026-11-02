import { createContext } from 'react';

import { type default as useChatActionReviews } from './use-chat-action-reviews';

export const ActionContext = createContext<ReturnType<typeof useChatActionReviews> | undefined>(
  undefined
);
