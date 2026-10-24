import { registerPortalRoutes } from './mcp-portal-portals.js';
import { type McpPortalStores, storesFor } from './mcp-portal-shared.js';
import { registerUpstreamRoutes } from './mcp-portal-upstreams.js';
import type { ManagementApiRouter, RouterInitArgs } from './types.js';

// Admin side of the MCP portal: portals, their servers, and who may use them. Mounted on the
// management API, so Logto's admin auth applies first. Everything is stored in Logto's database.
// The public endpoint that agents use is in mcp-portal-endpoint.ts.

export { type McpPortalStores, storesFor, upstreamPool } from './mcp-portal-shared.js';
export { unlockFor } from './mcp-portal-credentials.js';

/**
 * Registers the admin routes. `load` returns the stores for this request; production uses the
 * database, and tests pass fakes.
 */
export const registerMcpPortalRoutes = <T extends ManagementApiRouter>(
  router: T,
  load: () => Promise<McpPortalStores>
) => {
  registerPortalRoutes(router, load);
  registerUpstreamRoutes(router, load);
};

export default function mcpPortalRoutes<T extends ManagementApiRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  registerMcpPortalRoutes(router, async () => storesFor(tenant.envSet.pool));
}
