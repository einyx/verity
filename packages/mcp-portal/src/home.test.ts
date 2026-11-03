import { describe, expect, it } from 'vitest';

import { portalConnectCommands, portalHomeData } from './home.js';
import { type Portal } from './portals.js';
import { type Upstream } from './registry.js';

const portal: Portal = {
  id: 'portal-1',
  name: 'Velora Platform',
  hostname: 'mcp.velora.example',
  organizationIds: ['org-1', 'org-2'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const upstream = (over: Partial<Upstream> = {}): Upstream => ({
  name: 'github',
  url: 'https://upstream.example/mcp',
  portalId: 'portal-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  enabled: true,
  disabledTools: [],
  organizationIds: [],
  hasCredential: true,
  ...over,
});

describe('portalConnectCommands', () => {
  it('builds the portal URL and a slug from the portal name', () => {
    const { url, name } = portalConnectCommands(portal);

    expect(url).toBe('https://mcp.velora.example/mcp');
    expect(name).toBe('velora-platform');
  });

  it('falls back to a generic name when the slug would be empty', () => {
    expect(portalConnectCommands({ ...portal, name: '###' }).name).toBe('portal');
  });

  it('writes one command per supported client', () => {
    const { commands, setupPrompt } = portalConnectCommands(portal);

    expect(commands.claude).toBe(
      'claude mcp add --transport http velora-platform https://mcp.velora.example/mcp'
    );
    expect(commands.codex).toBe(
      'codex mcp add velora-platform --url https://mcp.velora.example/mcp'
    );
    expect(JSON.parse(commands.opencode)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: { 'velora-platform': { type: 'remote', url: 'https://mcp.velora.example/mcp' } },
    });
    expect(setupPrompt).toContain(`Portal URL: https://mcp.velora.example/mcp`);
    expect(setupPrompt).toContain(`Claude Code: ${commands.claude}`);
    expect(setupPrompt).toContain(`Codex: ${commands.codex}`);
    expect(setupPrompt).toContain(`OpenCode (add to opencode.json):`);
  });
});

describe('portalHomeData', () => {
  it('lists enabled servers the caller can see, and nothing else', () => {
    const data = portalHomeData(
      portal,
      [
        upstream({ name: 'open' }),
        upstream({ name: 'gated', organizationIds: ['org-2'] }),
        upstream({ name: 'other-org', organizationIds: ['org-9'] }),
        upstream({ name: 'switched-off', enabled: false }),
      ],
      ['org-2']
    );

    expect(data.servers).toEqual([
      { name: 'open', openToAllOrganizations: true },
      { name: 'gated', openToAllOrganizations: false },
    ]);
  });

  it('exposes server metadata only, never upstream URLs or credentials', () => {
    const [server] = portalHomeData(portal, [upstream()], ['org-1']).servers;

    expect(Object.keys(server ?? {}).toSorted()).toEqual(['name', 'openToAllOrganizations']);
  });

  it('carries the connect commands for the portal host', () => {
    const data = portalHomeData(portal, [], []);

    expect(data.url).toBe('https://mcp.velora.example/mcp');
    expect(data.commands.claude).toContain('https://mcp.velora.example/mcp');
  });
});
