import { randomUUID } from 'node:crypto';

import { hostnamePattern } from '@logto/mcp-portal';

import { EnvSet } from '#src/env-set/index.js';

import { readBoundedResponse } from './bounded-response.js';

const hostnameSuffix = '-mcp';

/** MCP portal hosting is managed by the deployment, not by individual tenants. */
export const managedPortalHosting = () => {
  // Managed MCP portal hostnames are a dev feature. Legacy tenant domains remain unchanged.
  if (!EnvSet.values.isDevFeaturesEnabled) {
    return;
  }

  const baseDomain = process.env.MCP_PORTAL_MANAGED_DOMAIN;

  if (!baseDomain || !hostnamePattern.test(baseDomain)) {
    return;
  }

  return { baseDomain, hostnameSuffix, managed: true as const };
};

/** Explicit labels remain stable; generated labels include entropy to avoid cross-tenant collisions. */
export const managedPortalHostname = (domain: string, name: string, subdomain?: string) => {
  const generated = name
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .slice(0, 44)
    .replaceAll(/^-+|-+$/g, '');
  const label = subdomain ?? `${generated || 'portal'}-${randomUUID().slice(0, 8)}`;

  if (!/^[\da-z](?:[\da-z-]{0,57}[\da-z])?$/.test(label)) {
    return;
  }

  const hostname = `${label}${hostnameSuffix}.${domain}`;

  return hostnamePattern.test(hostname) ? hostname : undefined;
};

const isManagedHostname = (hostname: string, domain: string) => {
  const ending = `${hostnameSuffix}.${domain}`;
  const label = hostname.endsWith(ending) ? hostname.slice(0, -ending.length) : '';

  return /^[\da-z](?:[\da-z-]{0,57}[\da-z])?$/.test(label);
};

/**
 * No credentials, redirects, custom ports, or tenant-controlled destinations are used. Only the
 * deployment's own managed HTTPS hosts can be probed; legacy custom domains are never fetched.
 */
export const portalHostingStatus = async (
  hostname: string,
  domain: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<{ status: 'ready' | 'pending' | 'unmanaged' }> => {
  if (!domain || !hostnamePattern.test(domain) || !isManagedHostname(hostname, domain)) {
    return { status: 'unmanaged' };
  }

  try {
    const response = await fetchImpl(`https://${hostname}/.well-known/oauth-protected-resource`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      await response.body?.cancel();
      return { status: 'pending' };
    }

    const body: unknown = JSON.parse(await readBoundedResponse(response, { maxBytes: 8192 }));

    return {
      status:
        typeof body === 'object' &&
        body !== null &&
        'resource' in body &&
        body.resource === `https://${hostname}/mcp`
          ? 'ready'
          : 'pending',
    };
  } catch {
    // DNS propagation, missing certificates and ingress failures are all pending, never ready.
    return { status: 'pending' };
  }
};
