import { ChatSessionStoreError } from './ai-chat-session-operation.js';
import { type ManagementApiRouterContext } from './types.js';

/** Map known storage failures only; unexpected errors reach the normal error handler. */
export const respondSession = async <T>(
  ctx: ManagementApiRouterContext,
  operation: () => Promise<T>,
  success = 200
) => {
  try {
    ctx.body = await operation();
    ctx.status = success;
  } catch (error) {
    if (!(error instanceof ChatSessionStoreError)) {
      throw error;
    }
    ctx.status =
      error.code === 'not_found'
        ? 404
        : error.code === 'content_limit'
          ? 413
          : error.code === 'ai_chat_not_configured' || error.code === 'ai_chat_unavailable'
            ? 503
            : 409;
    ctx.body = {
      error: error.code,
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    };
  }
};
