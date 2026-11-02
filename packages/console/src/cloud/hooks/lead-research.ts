import { useCallback } from 'react';
import { z } from 'zod/v3';

const leadResearchResponseGuard = z.object({
  findings: z.array(
    z.object({ summary: z.string(), sourceUrl: z.string().url(), retrievedAt: z.string() })
  ),
  draft: z.string(),
});
export type LandingLeadResearch = z.infer<typeof leadResearchResponseGuard>;
export type LeadResearchProvider = 'autoclaw' | 'claude';

export const useLeadResearch = (
  getToken: () => Promise<string | undefined>,
  request: (token: string | undefined, path: string, init?: RequestInit) => Promise<unknown>
) =>
  useCallback(
    async (sessionId: string, provider: LeadResearchProvider): Promise<LandingLeadResearch> => {
      const token = await getToken();
      return leadResearchResponseGuard.parse(
        await request(token, `/${encodeURIComponent(sessionId)}/research/${provider}`, {
          method: 'POST',
        })
      );
    },
    [getToken, request]
  );
