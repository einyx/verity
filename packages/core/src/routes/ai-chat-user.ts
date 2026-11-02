import type { ManagementApiRouterContext } from './types.js';

/** Persistent conversations and review gateways are human-owned, not app-ID-owned. */
export const requireChatUser = async (
  ctx: ManagementApiRouterContext,
  next: () => Promise<unknown>
) => {
  if (ctx.auth.type !== 'user') {
    ctx.status = 403;
    ctx.body = { error: 'user_principal_required' };
    return;
  }
  await next();
};
