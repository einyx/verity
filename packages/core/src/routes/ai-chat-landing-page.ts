import { landingPageDocumentGuard } from '@logto/schemas';
import { object, string } from 'zod/v3';

import RequestError from '#src/errors/RequestError/index.js';

import { readBoundedResponse } from './bounded-response.js';
import { type LogtoMcpTool, enabledLogtoMcpTools } from './mcp-logto-tools.js';

export const editLandingPageTool: LogtoMcpTool = {
  name: 'edit_landing_page',
  description:
    'Suggest an edit to the marketing landing page draft. For a new section, duplicate the closest existing section to preserve its structured blocks; for an AI section, use Security & Governance as the template when available. The result is proposed for confirmation and saved as a draft only; publishing remains separate.',
  path: '/landing-page/ai-edit',
  properties: {
    instruction: { type: 'string', description: 'The requested landing page change.' },
  },
  required: ['instruction'],
};

export const saveLandingPageDraftTool: LogtoMcpTool = {
  name: 'save_landing_page_draft',
  description: 'Save the exact confirmed landing page document as a draft, without publishing it.',
  path: '/landing-page/draft',
  method: 'PUT',
  properties: {},
  body: (args) => ({ ...landingPageDocumentGuard.parse(args.draft) }),
};

export const enabledAskAiTools = (isDevFeaturesEnabled: boolean): readonly LogtoMcpTool[] => [
  ...enabledLogtoMcpTools(isDevFeaturesEnabled),
  editLandingPageTool,
];

export const pendingActionTools = (isDevFeaturesEnabled: boolean): readonly LogtoMcpTool[] => [
  ...enabledLogtoMcpTools(isDevFeaturesEnabled),
  saveLandingPageDraftTool,
];

export const editLandingPageDraft = async ({
  instruction,
  apiBase,
  token,
  fetchImpl = fetch,
  assertActive = async () => {
    /* Legacy edits have no persisted lease. */
  },
}: {
  instruction: string;
  apiBase: string;
  token: string;
  fetchImpl?: typeof fetch;
  assertActive?: () => Promise<void>;
}) => {
  const parsedInstruction = string().trim().min(1).max(2000).parse(instruction);
  const base = apiBase.endsWith('/') ? apiBase : `${apiBase}/`;
  const headers = { authorization: `Bearer ${token}` };
  const request = async (path: string, init?: RequestInit) => {
    await assertActive();
    const signal = AbortSignal.timeout(60_000);
    const response = await fetchImpl(new URL(path, base), {
      ...init,
      headers: { ...headers, ...init?.headers },
      signal,
    });

    await assertActive();
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new RequestError({
          code: response.status === 401 ? 'auth.unauthorized' : 'auth.forbidden',
          status: response.status,
        });
      }
      throw new Error(`Landing page editor request failed (${response.status})`);
    }

    const body: unknown = JSON.parse(
      await readBoundedResponse(response, { maxBytes: 2_000_000, signal })
    );
    await assertActive();
    return body;
  };

  const { draft } = object({ draft: landingPageDocumentGuard }).parse(
    await request('landing-page/editor')
  );
  const result: unknown = await request('landing-page/ai-edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instruction: parsedInstruction, draft }),
  });

  return object({ draft: landingPageDocumentGuard }).parse(result).draft;
};
