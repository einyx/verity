import { randomUUID } from 'node:crypto';

import { type AuditEvent } from './audit.js';
import { type Caller } from './auth.js';
import { type Portal } from './portals.js';
import { type Upstream } from './registry.js';

// The grant rules shared by the MCP protocol endpoint and the portal home page, so the two surfaces
// cannot drift on who a portal admits and which of its servers a caller may see.

/**
 * Whether a caller's organizations admit them to this upstream. A server with no organization list
 * is open to everyone the portal admits; otherwise the caller must belong to one of the listed
 * organizations, and the server is hidden from everyone else.
 */
export const visibleUpstream = (upstream: Upstream, callerOrganizationIds: string[]): boolean =>
  upstream.organizationIds.length === 0 ||
  upstream.organizationIds.some((id) => callerOrganizationIds.includes(id));

export type GrantedOrganizationsDeps = {
  portal: Portal;
  /** The caller's access token, passed through to the organization lookup. */
  token: string;
  caller: Caller;
  /** Resolves the caller's organization IDs from their token. */
  lookup: (accessToken: string) => Promise<string[]>;
  audit: (event: AuditEvent) => void;
  /** Writes one line to the error log. Injected so tests stay quiet; production writes to stderr. */
  logError: (line: string) => void;
};

/**
 * The caller's organizations that are granted to the portal. Undefined means the caller is refused:
 * the portal grants no organizations, the lookup failed, or the caller belongs to none of them.
 */
export const grantedOrganizations = async ({
  portal,
  token,
  caller,
  lookup,
  audit,
  logError,
}: GrantedOrganizationsDeps): Promise<string[] | undefined> => {
  if (portal.organizationIds.length === 0) {
    audit({
      action: 'portal.access',
      sub: caller.sub,
      portal: portal.id,
      outcome: 'denied',
      reason: 'no_grants',
    });
    return undefined;
  }

  const organizationIds = await lookup(token).catch((error: unknown) => {
    logError(`mcp_portal_error ${randomUUID()} organization lookup: ${String(error)}`);
  });

  if (!organizationIds) {
    audit({
      action: 'portal.access',
      sub: caller.sub,
      portal: portal.id,
      outcome: 'error',
      reason: 'lookup_failed',
    });
    return undefined;
  }

  const granted = organizationIds.filter((id) => portal.organizationIds.includes(id));

  audit({
    action: 'portal.access',
    sub: caller.sub,
    portal: portal.id,
    outcome: granted.length > 0 ? 'ok' : 'denied',
    ...(granted.length > 0 ? {} : { reason: 'not_in_granted_organization' }),
  });

  return granted.length > 0 ? granted : undefined;
};
