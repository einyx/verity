import { describe, expect, it, type Mock, vi } from 'vitest';

import { type AuditEvent } from './audit.js';
import { type Caller } from './auth.js';
import { grantedOrganizations, visibleUpstream } from './grants.js';
import { type Portal } from './portals.js';
import { type Upstream } from './registry.js';

const caller: Caller = { sub: 'user-1', scopes: [] };

const portal = (organizationIds: string[]): Portal => ({
  id: 'portal-1',
  name: 'Velora',
  hostname: 'velora-mcp',
  organizationIds,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const upstream = (organizationIds: string[]): Upstream => ({
  name: 'github',
  url: 'https://upstream.example/mcp',
  portalId: 'portal-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  enabled: true,
  disabledTools: [],
  organizationIds,
  hasCredential: false,
});

const auditEvents = (audit: Mock<(event: AuditEvent) => void>) =>
  audit.mock.calls.map(([event]) => event);

describe('visibleUpstream', () => {
  it('admits everyone when the upstream lists no organizations', () => {
    expect(visibleUpstream(upstream([]), [])).toBeTruthy();
  });

  it('admits a caller who belongs to a listed organization', () => {
    expect(visibleUpstream(upstream(['org-1', 'org-2']), ['org-2', 'org-3'])).toBeTruthy();
  });

  it('hides the upstream from a caller outside its organizations', () => {
    expect(visibleUpstream(upstream(['org-1']), ['org-2'])).toBeFalsy();
  });
});

const run = async (
  organizationIds: Portal['organizationIds'],
  lookup: (accessToken: string) => Promise<string[]>
) => {
  const audit = vi.fn<(event: AuditEvent) => void>();
  const logError = vi.fn<(line: string) => void>();
  const granted = await grantedOrganizations({
    portal: portal(organizationIds),
    token: 'token',
    caller,
    lookup,
    audit,
    logError,
  });

  return { granted, audit, logError };
};

describe('grantedOrganizations', () => {
  it('refuses the caller when the portal grants no organizations', async () => {
    const { granted, audit, logError } = await run(
      [],
      vi.fn(async () => ['org-1'])
    );

    expect(granted).toBeUndefined();
    expect(auditEvents(audit)).toEqual([
      {
        action: 'portal.access',
        sub: caller.sub,
        portal: 'portal-1',
        outcome: 'denied',
        reason: 'no_grants',
      },
    ]);
    expect(logError).not.toHaveBeenCalled();
  });

  it('refuses the caller and logs when the organization lookup fails', async () => {
    const { granted, audit, logError } = await run(
      ['org-1'],
      vi.fn(async () => {
        throw new Error('issuer down');
      })
    );

    expect(granted).toBeUndefined();
    expect(auditEvents(audit)).toEqual([
      {
        action: 'portal.access',
        sub: caller.sub,
        portal: 'portal-1',
        outcome: 'error',
        reason: 'lookup_failed',
      },
    ]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toMatch(/^mcp_portal_error .* organization lookup:/);
  });

  it('returns the organizations the caller shares with the portal', async () => {
    const { granted, audit, logError } = await run(['org-1', 'org-2'], async () => [
      'org-2',
      'org-3',
    ]);

    expect(granted).toEqual(['org-2']);
    expect(auditEvents(audit)).toEqual([
      { action: 'portal.access', sub: caller.sub, portal: 'portal-1', outcome: 'ok' },
    ]);
    expect(logError).not.toHaveBeenCalled();
  });

  it('refuses a caller who belongs to none of the granted organizations', async () => {
    const { granted, audit } = await run(['org-1'], async () => ['org-3']);

    expect(granted).toBeUndefined();
    expect(auditEvents(audit)).toEqual([
      {
        action: 'portal.access',
        sub: caller.sub,
        portal: 'portal-1',
        outcome: 'denied',
        reason: 'not_in_granted_organization',
      },
    ]);
  });
});
