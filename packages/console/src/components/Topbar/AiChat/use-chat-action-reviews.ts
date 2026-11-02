import { type ChatReview } from '@logto/schemas';
import { useRef, useState } from 'react';

import { type ProposedAction } from './ProposedActionCard';
import { confirmChatAction } from './confirm-action';
import { reviewAction } from './session-review';

type Operation = 'confirm' | 'cancel' | 'refresh';
type ReviewState = Pick<ProposedAction, 'status' | 'message'> & {
  replacement?: ProposedAction;
  operation?: Operation;
  authority?: ChatReview[];
};
type Options = {
  reviews?: ChatReview[];
  hydrated?: boolean;
  disabled?: boolean;
  confirm: (id: string) => Promise<unknown>;
  cancel: (id: string) => Promise<unknown>;
  refresh: (action: ProposedAction) => Promise<ProposedAction>;
  refreshEditor: () => Promise<unknown>;
  failureMessage: string;
};

/** Locks synchronously, before React renders, and keeps ownership outside the review modal. */
export default function useChatActionReviews(options: Options) {
  const current = useRef<Record<string, ReviewState | undefined>>({});
  const operations = useRef(new Map<string, symbol>());
  const [statuses, setStatuses] = useState(current.current);
  const authoritative = Object.fromEntries(
    (options.reviews ?? []).map((review) => [
      review.originalActionId,
      {
        status: reviewAction(review).status,
        replacement: reviewAction(review),
      },
    ])
  );
  const merged: Record<string, ReviewState | undefined> = Object.fromEntries(
    [...new Set([...Object.keys(authoritative), ...Object.keys(statuses)])].map((key) => {
      const state = authoritative[key];
      const local = statuses[key];
      if (
        state &&
        !local?.operation &&
        (state.status !== 'pending' ||
          local?.replacement?.id !== state.replacement.id ||
          (local.status === 'failed' && local.authority !== options.reviews))
      ) {
        // Server terminal/replacement state beats stale cached pending, never an in-flight lock.
        return [key, { ...local, ...state }];
      }
      return [key, local ?? state];
    })
  );
  const update = (key: string, state: ReviewState) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Ref is the synchronous operation gate between renders.
    current.current = { ...current.current, [key]: state };
    setStatuses(current.current);
  };
  const begin = (key: string, id: string, operation: Operation) => {
    const state = merged[key];
    const review = options.reviews?.find((item) => item.originalActionId === key);
    if (
      options.hydrated === false ||
      options.disabled === true ||
      (options.reviews !== undefined && !review) ||
      (review
        ? review.currentActionId !== id ||
          review.state === 'confirmed' ||
          review.state === 'executed' ||
          review.state === 'cancelled' ||
          (operation === 'confirm' &&
            (review.state === 'expired' || Date.parse(review.expiresAt) <= Date.now()))
        : false) ||
      operations.current.has(key) ||
      (state?.replacement?.id ?? key) !== id ||
      state?.status === 'done' ||
      state?.status === 'cancelled'
    ) {
      return;
    }
    const token = Symbol(operation);
    operations.current.set(key, token);
    update(key, {
      ...state,
      status: operation === 'confirm' ? 'running' : (state?.status ?? 'pending'),
      operation,
      authority: options.reviews,
      message: undefined,
    });
    return token;
  };
  const finish = (key: string, id: string, token: symbol, state: ReviewState) => {
    if (
      operations.current.get(key) !== token ||
      (current.current[key]?.replacement?.id ?? merged[key]?.replacement?.id ?? key) !== id
    ) {
      return;
    }
    operations.current.delete(key);
    update(key, { ...current.current[key], ...state, operation: undefined });
  };

  return {
    isHydrated: options.hydrated !== false,
    canOperate: options.hydrated !== false && !options.disabled,
    statuses: merged,
    onConfirm: (action: Pick<ProposedAction, 'id' | 'tool'>, key = action.id) => {
      const token = begin(key, action.id, 'confirm');
      if (!token) {
        return;
      }
      void (async () => {
        try {
          await confirmChatAction(action, options.confirm, options.refreshEditor);
          finish(key, action.id, token, { status: 'done' });
        } catch {
          finish(key, action.id, token, { status: 'failed', message: options.failureMessage });
        }
      })();
    },
    onCancel: (id: string, key = id) => {
      const token = begin(key, id, 'cancel');
      if (!token) {
        return;
      }
      void (async () => {
        try {
          await options.cancel(id);
        } catch {
          /* A discarded proposal expires server-side if cancellation cannot reach it. */
        }
        finish(key, id, token, { status: 'cancelled' });
      })();
    },
    onRefresh: async (action: ProposedAction, key = action.id) => {
      const token = begin(key, action.id, 'refresh');
      if (!token) {
        return;
      }
      try {
        const replacement = await options.refresh(action);
        finish(key, action.id, token, { status: 'pending', replacement });
      } catch (error) {
        finish(key, action.id, token, { status: 'failed', message: options.failureMessage });
        throw error;
      }
    },
  };
}
