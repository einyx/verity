import { useLogto } from '@logto/react';
import { useCallback } from 'react';
import useSWR from 'swr';
import { z } from 'zod';

import { cloudApi } from '@/consts';

// Read-only access to the landing demo chat's leads (dev feature, admin tenant only). A transcript is
// loaded only when a lead is opened, so the list never pulls whole conversations.

const leadsBase = '/api/landing-leads';

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
  companyProfile: z.record(z.unknown()).nullable().optional(),
  createdAt: z.union([z.string(), z.number()]),
});

export type LandingLead = z.infer<typeof landingLeadGuard>;

type LeadsListing = { leads: LandingLead[]; bookingUrl?: string | undefined };

const leadsResponseGuard = z.object({
  leads: z.array(landingLeadGuard),
  bookingUrl: z.string().nullable().optional(),
});

const transcriptResponseGuard = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

export type LandingLeadTranscript = z.infer<typeof transcriptResponseGuard>['messages'];

const request = async (token: string | undefined, path: string): Promise<unknown> => {
  const response = await fetch(`${window.location.origin}${leadsBase}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  });

  if (!response.ok) {
    throw new Error(`Leads request failed: ${response.status}`);
  }

  return response.json();
};

export const useLandingLeads = () => {
  const { isAuthenticated, getAccessToken } = useLogto();

  const getToken = useCallback(async () => getAccessToken(cloudApi.indicator), [getAccessToken]);

  const { data, error, isLoading } = useSWR<LeadsListing, Error>(
    isAuthenticated ? `${leadsBase}/list` : undefined,
    async (): Promise<LeadsListing> => {
      const token = await getToken();
      const body = leadsResponseGuard.parse(await request(token, ''));
      return { leads: body.leads, bookingUrl: body.bookingUrl ?? undefined };
    }
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
    leads: data?.leads,
    loadSlidesPptx,
    bookingUrl: data?.bookingUrl ?? undefined,
    error,
    isLoading,
    loadTranscript,
    loadBriefPdf,
    loadSlides,
  };
};
