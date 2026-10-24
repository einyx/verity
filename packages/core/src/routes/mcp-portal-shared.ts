import {
  createAudit,
  PostgresPortalSettingsStore,
  PostgresPortalStore,
  PostgresUpstreamStore,
  type PortalSettingsStore,
  type PortalStore,
  type Upstream,
  type UpstreamStore,
  UpstreamPool,
} from '@logto/mcp-portal';
import { type CommonQueryMethods } from '@silverhand/slonik';

import type { ManagementApiRouterContext } from './types.js';

export type McpPortalStores = {
  portals: PortalStore;
  upstreams: UpstreamStore;
  settings: PortalSettingsStore;
};

export const audit = createAudit();

/** One connection pool for the whole process, shared with the public endpoint. */
export const upstreamPool = new UpstreamPool();

export const portalIdPattern = /^[\w-]{1,64}$/;

/**
 * The stores over a tenant's database. The portal tables are created by a schema alteration, so
 * requests only read and write them.
 */
export const storesFor = (database: CommonQueryMethods): McpPortalStores => ({
  portals: new PostgresPortalStore(database),
  upstreams: new PostgresUpstreamStore(database),
  settings: new PostgresPortalSettingsStore(database),
});

export const invalidPortal = (ctx: ManagementApiRouterContext) => {
  ctx.status = 400;
  ctx.body = { code: 'mcp_portal.invalid_portal_id', message: 'Invalid portal id' };
};

export const invalidName = (ctx: ManagementApiRouterContext) => {
  ctx.status = 400;
  ctx.body = { code: 'mcp_portal.invalid_name', message: 'Invalid portal or upstream name' };
};

export const notFound = (ctx: ManagementApiRouterContext, message: string) => {
  ctx.status = 404;
  ctx.body = { code: 'mcp_portal.not_found', message };
};

export const upstreamView = ({
  name,
  url,
  createdAt,
  enabled,
  disabledTools,
  organizationIds,
  hasCredential,
}: Upstream) => ({
  name,
  url,
  createdAt,
  enabled,
  disabledTools,
  organizationIds,
  hasCredential,
});
