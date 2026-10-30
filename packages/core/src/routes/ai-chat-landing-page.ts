import { landingPageDocumentGuard } from '@logto/schemas';
import { object, string } from 'zod/v3';

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
  devFeature: true,
};

export const saveLandingPageDraftTool: LogtoMcpTool = {
  name: 'save_landing_page_draft',
  description: 'Save the exact confirmed landing page document as a draft, without publishing it.',
  path: '/landing-page/draft',
  method: 'PUT',
  properties: {},
  body: (args) => ({ ...landingPageDocumentGuard.parse(args.draft) }),
  devFeature: true,
};

export const enabledAskAiTools = (isDevFeaturesEnabled: boolean): readonly LogtoMcpTool[] => [
  ...enabledLogtoMcpTools(isDevFeaturesEnabled),
  ...(isDevFeaturesEnabled ? [editLandingPageTool] : []),
];

export const pendingActionTools = (isDevFeaturesEnabled: boolean): readonly LogtoMcpTool[] => [
  ...enabledLogtoMcpTools(isDevFeaturesEnabled),
  ...(isDevFeaturesEnabled ? [saveLandingPageDraftTool] : []),
];

export const editLandingPageDraft = async ({
  instruction,
  apiBase,
  token,
  fetchImpl = fetch,
}: {
  instruction: string;
  apiBase: string;
  token: string;
  fetchImpl?: typeof fetch;
}) => {
  const parsedInstruction = string().trim().min(1).max(2000).parse(instruction);
  const base = apiBase.endsWith('/') ? apiBase : `${apiBase}/`;
  const headers = { authorization: `Bearer ${token}` };
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetchImpl(new URL(path, base), {
      ...init,
      headers: { ...headers, ...init?.headers },
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Landing page editor request failed (${response.status})`);
    }

    return response.json();
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
