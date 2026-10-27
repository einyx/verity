import { kuboPortalUrl } from './kubo-portal-url.js';
import { type DemoLead } from './landing-page-chat-guard.js';

// Files a website demo request with the Kubo portal, which creates a DemoRequest resource. The portal
// creates it unapproved: an operator approves it before any tenant is deployed. The call is made only
// when `KUBO_DEMO_REQUEST_TOKEN` is set, because the portal's endpoint is disabled without the shared
// token, so an unconfigured instance never sends anything.

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number }>;

type DemoRequestBody = {
  contact: {
    firstName: string;
    lastName?: string;
    role?: string;
    industry?: string;
    interested?: string;
    decision?: string;
  };
  email: string;
  company?: string;
};

/** Maps the chat's lead to the portal's request body. Empty optional fields are left out. */
export const toDemoRequestBody = (lead: DemoLead): DemoRequestBody => {
  const interested = lead.interests?.join(', ');

  return {
    contact: {
      firstName: lead.firstName,
      ...(lead.lastName ? { lastName: lead.lastName } : {}),
      ...(lead.role ? { role: lead.role } : {}),
      ...(lead.industry ? { industry: lead.industry } : {}),
      ...(interested ? { interested } : {}),
      ...(lead.decision ? { decision: lead.decision } : {}),
    },
    email: lead.email,
    ...(lead.company ? { company: lead.company } : {}),
  };
};

/**
 * Creates the demo request in the Kubo portal. Returns false when the call is not configured, and
 * throws when the portal refuses it, so the caller can log the failure without the lead's details.
 */
export const createDemoRequest = async (
  lead: DemoLead,
  options: { token?: string; fetch: FetchLike; baseUrl?: string }
): Promise<boolean> => {
  if (!options.token) {
    return false;
  }

  const response = await options.fetch(`${options.baseUrl ?? kuboPortalUrl()}/api/demorequests`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(toDemoRequestBody(lead)),
    // The portal is a separate service: a slow or unreachable one must not hold up the visitor's reply.
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Kubo portal refused the demo request with status ${response.status}`);
  }

  return true;
};
