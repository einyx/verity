import { ConsoleLog } from '@logto/shared';
import { z } from 'zod/v3';

import { proposeLandingPageEdit } from './ai-chat-landing-page-action.js';

const audit = new ConsoleLog('ask-ai-landing');

/** Routing only, never authorization. Do not turn checklist/ideas/questions into proposal writes. */
export const isExplicitLandingPageEditRequest = (text: string) => {
  if (
    /\b(?:do not|don't|never)\s+(?:edit|change|rewrite|generate)(?=\s*(?:[!.:;?]|$))/i.test(text) ||
    /\b(?:do not|don't|never)\s+(?:(?:edit|change|rewrite)\s+(?:(?:the\s+)?landing[\s-]*page|(?:the\s+)?page|it|anything)|generate\s+(?:(?:an?|any|the)\s+)?(?:improvement\s+)?(?:proposal|preview|draft|edit|changes?|anything|page))\b/i.test(
      text
    )
  ) {
    return false;
  }
  return (
    /^\s*(?:please\s+)?(?:edit|improve|change|update|rewrite|redesign)\s+(?:the\s+)?landing[\s-]*page(?=$|[!.:;]|\s+(?:and|to|by|with|for|so)\b)/i.test(
      text
    ) ||
    (/^\s*(?:please\s+)?review\s+(?:the\s+)?landing[\s-]*page\s+and\s+suggest\b/i.test(text) &&
      /\b(?:improvement|change|edit)\b/i.test(text) &&
      /\b(?:preview|proposal)\b/i.test(text))
  );
};

/** Backend-derived metadata only; no prompt, subject, credential, page, or provider response. */
export const recordLandingPageOperation = (
  state:
    | 'authorized'
    | 'authentication_required'
    | 'forbidden'
    | 'unavailable'
    | 'proposed'
    | 'invalid_request'
    | 'proposal_failed',
  requestId?: string,
  stage: 'capability' | 'proposal' = 'capability'
) => {
  audit.info(
    JSON.stringify({
      event: 'landing_page_edit',
      stage,
      state,
      ...(requestId && /^[\w-]{1,128}$/.test(requestId) ? { requestId } : {}),
    })
  );
};

/** Explicit page-edit intent does not need an LLM planner to decide whether the user has rights. */
export const dispatchLandingPageEdit = async (
  options: Parameters<typeof proposeLandingPageEdit>[0],
  requestId?: string
) => {
  if (options.instruction.trim().length > 2000) {
    await options.assertActive?.();
    recordLandingPageOperation('invalid_request', requestId, 'proposal');
    return {
      ok: true as const,
      content:
        'Please limit the landing-page edit request to 2,000 characters. The page was not saved or published.',
      actions: [],
    };
  }
  const proposal = await proposeLandingPageEdit(options);
  await options.assertActive?.();
  const actions = [...options.actions.values()];
  const failure = z
    .object({ error: z.string().optional(), message: z.string().optional() })
    .safeParse(JSON.parse(proposal.response));
  const error = failure.success ? failure.data.error : undefined;
  recordLandingPageOperation(
    actions.length > 0
      ? 'proposed'
      : error === 'landing_page_forbidden'
        ? 'forbidden'
        : error === 'landing_page_authentication_failed'
          ? 'authentication_required'
          : 'proposal_failed',
    requestId,
    'proposal'
  );
  return {
    ok: true as const,
    content:
      actions.length > 0
        ? 'Your landing-page edit proposal is ready to preview. The page was not saved or published. Save draft requires your explicit confirmation; publishing is separate.'
        : failure.success && failure.data.message
          ? failure.data.message
          : 'The landing-page edit proposal could not be generated. The page was not saved or published.',
    actions,
  };
};
