import { visibleUpstream } from './grants.js';
import { type Portal } from './portals.js';
import { type Upstream } from './registry.js';

// The data the portal home page shows an authenticated caller, and the commands that connect an MCP
// client to the portal. Metadata only: upstream URLs and credentials never leave the server.

/** The MCP clients the connect commands are written for. */
export type McpClient = 'claude' | 'codex' | 'opencode';

const clientLabels: Record<McpClient, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/** The URL, a short name for the portal, and each client's setup command. */
export const portalConnectCommands = (portal: Pick<Portal, 'name' | 'hostname'>) => {
  const url = `https://${portal.hostname}/mcp`;
  // Collapse to a slug, then trim the edges so names without usable characters still get one.
  const name =
    portal.name
      .toLowerCase()
      .replaceAll(/[^\da-z]+/g, '-')
      .replaceAll(/^-+|-+$/g, '') || 'portal';
  const commands: Record<McpClient, string> = {
    claude: `claude mcp add --transport http ${name} ${url}`,
    codex: `codex mcp add ${name} --url ${url}`,
    opencode: JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        mcp: { [name]: { type: 'remote', url } },
      },
      null,
      2
    ),
  };
  const setupPrompt = [
    "Add this MCP portal to my MCP client. Run the command for the client you use, restart it, then confirm the portal's servers are listed.",
    '',
    `Portal URL: ${url}`,
    '',
    `${clientLabels.claude}: ${commands.claude}`,
    `${clientLabels.codex}: ${commands.codex}`,
    `${clientLabels.opencode} (add to opencode.json):\n${commands.opencode}`,
  ].join('\n');

  return { url, name, commands, setupPrompt };
};

export type PortalHomeServer = {
  name: string;
  /** Whether every organization the portal admits can use this server, not just some of them. */
  openToAllOrganizations: boolean;
};

export type PortalHomeData = ReturnType<typeof portalConnectCommands> & {
  /** The servers the caller's organizations can use and that admins have left switched on. */
  servers: PortalHomeServer[];
};

/** The portal home page's view of a portal for one caller, built from preloaded upstreams. */
export const portalHomeData = (
  portal: Portal,
  upstreams: Upstream[],
  callerOrganizationIds: string[]
): PortalHomeData => ({
  ...portalConnectCommands(portal),
  servers: upstreams
    .filter((upstream) => upstream.enabled && visibleUpstream(upstream, callerOrganizationIds))
    .map(({ name, organizationIds }) => ({
      name,
      openToAllOrganizations: organizationIds.length === 0,
    })),
});
