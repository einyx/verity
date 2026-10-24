import { useLogto } from '@logto/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { z } from 'zod/v3';

import { cloudApi } from '@/consts';

// Read-only access to the landing demo chat's leads (dev feature, admin tenant only). A transcript is
// loaded only when a lead is opened, so the list never pulls whole conversations.
//
// Self-hosted implementation inside the Verity API (no cloud CRM, all in our Postgres + routes).

const leadsBase = '/api/landing-leads';

export type LandingLeadQuery = {
  readonly search?: string;
  readonly stage?: string;
  /** Exact tag match; text inputs should use tagSearch instead. */
  readonly tag?: string;
  readonly tagSearch?: string;
  /** 1-based page number. */
  readonly page: number;
  readonly pageSize: number;
};

/** Stable SWR key, including the API path and encoded filters. */
export const buildLeadsQuery = (query: LandingLeadQuery): string => {
  const pageSize =
    Number.isFinite(query.pageSize) && query.pageSize >= 1
      ? Math.min(100, Math.floor(query.pageSize))
      : 20;
  const page = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page)) : 1;
  // Cap whole pages so multiplication cannot overflow the API's safe integer offset.
  const offset = Math.min(page - 1, Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) * pageSize;
  const filters = (['search', 'stage', 'tag', 'tagSearch'] as const).flatMap((name) =>
    query[name] ? [`${name}=${encodeURIComponent(query[name])}`] : []
  );

  return `${leadsBase}?${[...filters, `limit=${pageSize}`, `offset=${offset}`].join('&')}`;
};

const landingLeadGuard = z.object({
  id: z.string(),
  sessionId: z.string(),
  lead: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      company: z.string(),
      role: z.string().optional(),
      industry: z.string().optional(),
      interests: z.array(z.string()).optional(),
      decision: z.string().optional(),
      contactMethod: z.string().optional(),
      contactDetail: z.string().optional(),
    })
    .passthrough(),
  emailStatus: z.string(),
  status: z.string(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  companyProfile: z.record(z.unknown()).nullable().optional(),
  createdAt: z.union([z.string(), z.number()]),
});

export type LandingLead = z.infer<typeof landingLeadGuard>;

type LeadsListing = { leads: LandingLead[]; totalCount: number; bookingUrl?: string | undefined };
const assistResultGuard = z.object({
  summary: z.string(),
  qualification: z.enum(['high', 'medium', 'low', 'unclear']),
  rationale: z.array(z.string()),
  suggestedNextSteps: z.array(z.string()),
  followUpDraft: z.string(),
});
export type LandingLeadAssist = z.infer<typeof assistResultGuard>;

const leadsResponseGuard = z.object({
  leads: z.array(landingLeadGuard),
  totalCount: z.number().int().nonnegative(),
  bookingUrl: z.string().nullable().optional(),
});

const countGuard = z.number().int().nonnegative();
const leadStatsGuard = z
  .object({
    total: countGuard,
    byStage: z.array(
      z
        .object({
          stage: z.string(),
          count: countGuard,
          last7Days: countGuard,
          previous7Days: countGuard,
        })
        .passthrough()
    ),
    byWeek: z.array(z.object({ weekStart: z.string(), count: countGuard }).passthrough()),
  })
  .passthrough();

export type LeadStats = {
  readonly total: number;
  readonly byStage: ReadonlyArray<{
    readonly stage: string;
    readonly count: number;
    readonly last7Days: number;
    readonly previous7Days: number;
  }>;
  readonly byWeek: ReadonlyArray<{ readonly weekStart: string; readonly count: number }>;
};

const transcriptResponseGuard = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

export type LandingLeadTranscript = z.infer<typeof transcriptResponseGuard>['messages'];

const request = async (
  token: string | undefined,
  path: string,
  init?: RequestInit
): Promise<unknown> => {
  const response = await fetch(`${window.location.origin}${leadsBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token ?? ''}`, ...init?.headers },
  });

  if (!response.ok) {
    throw new Error(`Leads request failed: ${response.status}`);
  }

  return response.json();
};

// Preserve the legacy queue size until its caller opts into server-side pagination.
const defaultLeadQuery: LandingLeadQuery = { page: 1, pageSize: 50 };

export const useLandingLeads = (query: LandingLeadQuery = defaultLeadQuery) => {
  const { isAuthenticated, getAccessToken } = useLogto();
  const key = buildLeadsQuery(query);
  const shouldRefreshOnQueryChange = query !== defaultLeadQuery;
  // A -> B -> A is a new visit, even though A's old listing is still cached.
  const generation = useMemo(
    () => ({ key, isAuthenticated, shouldRefreshOnQueryChange }),
    [key, isAuthenticated, shouldRefreshOnQueryChange]
  );
  const [completedGeneration, setCompletedGeneration] = useState<typeof generation>();

  const getToken = useCallback(async () => getAccessToken(cloudApi.indicator), [getAccessToken]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<LeadsListing, Error>(
    isAuthenticated ? key : undefined,
    async (requestKey: string): Promise<LeadsListing> => {
      const token = await getToken();
      const body = leadsResponseGuard.parse(
        await request(token, requestKey.slice(leadsBase.length))
      );
      return {
        leads: body.leads,
        totalCount: body.totalCount,
        bookingUrl: body.bookingUrl ?? undefined,
      };
    },
    // Explicit queries force an entry refresh rather than trusting a cached/deduped revalidation.
    shouldRefreshOnQueryChange ? { revalidateOnMount: false, revalidateIfStale: false } : undefined
  );

  useEffect(() => {
    if (!isAuthenticated || !shouldRefreshOnQueryChange) {
      return;
    }
    const lifetime = new AbortController();
    const refresh = async () => {
      try {
        await mutate();
        if (!lifetime.signal.aborted) {
          setCompletedGeneration(generation);
        }
      } catch {
        // SWR exposes the request error; failed or abandoned visits never authorize a page clamp.
      }
    };
    void refresh();
    return () => {
      lifetime.abort();
    };
  }, [generation, isAuthenticated, mutate, shouldRefreshOnQueryChange]);

  const hasFreshResponse =
    Boolean(data) &&
    !error &&
    !isValidating &&
    (!shouldRefreshOnQueryChange || completedGeneration === generation);

  const updateLead = useCallback(
    async (id: string, fields: { status?: string; notes?: string; tags?: string[] }) => {
      const token = await getToken();
      await request(token, `/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
    },
    [getToken]
  );

  const loadAssist = useCallback(
    async (sessionId: string): Promise<LandingLeadAssist> => {
      const token = await getToken();
      const body = await request(token, `/${encodeURIComponent(sessionId)}/assist`, {
        method: 'POST',
      });
      return assistResultGuard.parse(z.object({ result: z.unknown() }).parse(body).result);
    },
    [getToken]
  );

  // Loads one session's transcript, only when the team opens that lead.
  const loadTranscript = useCallback(
    async (sessionId: string): Promise<LandingLeadTranscript> => {
      const token = await getToken();
      const body = await request(token, `/${encodeURIComponent(sessionId)}/transcript`);
      return transcriptResponseGuard.parse(body).messages;
    },
    [getToken]
  );

  // The PDF needs the admin token, so it is fetched here and handed to the page as a file.
  const loadBriefPdf = useCallback(
    async (sessionId: string): Promise<Blob> => {
      const token = await getToken();
      const response = await fetch(
        `${window.location.origin}${leadsBase}/${encodeURIComponent(sessionId)}/brief.pdf`,
        { headers: { Authorization: `Bearer ${token ?? ''}` } }
      );

      if (!response.ok) {
        throw new Error(`Brief request failed: ${response.status}`);
      }

      return response.blob();
    },
    [getToken]
  );

  // The slides need the admin token too, so they are fetched here as a file, like the brief.
  const loadSlides = useCallback(
    async (sessionId: string): Promise<Blob> => {
      const token = await getToken();
      const response = await fetch(
        `${window.location.origin}${leadsBase}/${encodeURIComponent(sessionId)}/slides.pptx`,
        { headers: { Authorization: `Bearer ${token ?? ''}` } }
      );

      if (!response.ok) {
        throw new Error(`Slides request failed: ${response.status}`);
      }

      return response.blob();
    },
    [getToken]
  );

  // The slides are fetched with the admin token, the same way as the brief.
  const loadSlidesPptx = useCallback(
    async (sessionId: string): Promise<Blob> => {
      const token = await getToken();
      const response = await fetch(
        `${window.location.origin}${leadsBase}/${encodeURIComponent(sessionId)}/slides.pptx`,
        { headers: { Authorization: `Bearer ${token ?? ''}` } }
      );

      if (!response.ok) {
        throw new Error(`Slides request failed: ${response.status}`);
      }

      return response.blob();
    },
    [getToken]
  );

  return {
    key,
    totalCount: data?.totalCount ?? 0,
    mutate,
    leads: data?.leads,
    loadSlidesPptx,
    bookingUrl: data?.bookingUrl ?? undefined,
    error,
    isLoading:
      isLoading ||
      (isAuthenticated &&
        shouldRefreshOnQueryChange &&
        completedGeneration !== generation &&
        !error),
    hasFreshResponse,
    loadTranscript,
    updateLead,
    loadAssist,
    loadBriefPdf,
    loadSlides,
  };
};

export const useLandingLeadStats = () => {
  const { isAuthenticated, getAccessToken } = useLogto();
  const key = `${leadsBase}/stats`;
  const { data, error, isLoading, mutate } = useSWR<LeadStats, Error>(
    isAuthenticated ? key : undefined,
    async (): Promise<LeadStats> => {
      const token = await getAccessToken(cloudApi.indicator);
      return leadStatsGuard.parse(await request(token, '/stats'));
    }
  );

  return { key, data, error, isLoading, mutate };
};
