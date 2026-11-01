import { type FC } from 'react';

/** One quiet stroke vocabulary for the shell, independent of page-specific illustrations. */
const menuIcon = (path: string): FC => {
  function MenuIcon() {
    return (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    );
  }
  return MenuIcon;
};

const home = 'M3 10 12 3l9 7v11h-7v-7h-4v7H3Z';
const grid = 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z';
const app = 'M3 4h18v16H3ZM3 9h18M7 6.5h.1M10 6.5h.1';
const shield = 'M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6ZM8 12l3 3 5-6';
const plug = 'M8 3v5M16 3v5M6 8h12v5a6 6 0 0 1-12 0ZM12 19v3';
const cube = 'M12 3 21 8v9l-9 5-9-5V8ZM12 13v9M3 8l9 5 9-5M7 6l9 5';
const layers = 'M12 3 22 9 12 15 2 9ZM3 13l9 5 9-5M3 17l9 5 9-5';
const users =
  'M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM2 21v-3a7 7 0 0 1 14 0v3M16 4a4 4 0 0 1 0 8M19 15a6 6 0 0 1 3 6';
const terminal = 'M3 4h18v16H3ZM7 9l3 3-3 3M13 15h4';
const settings =
  'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM6 19c1-6 11-6 12 0';

export const menuIcons = {
  get_started: menuIcon(home),
  dashboard: menuIcon(grid),
  applications: menuIcon(app),
  sign_in_experience: menuIcon(app),
  mfa: menuIcon(shield),
  connectors: menuIcon(plug),
  enterprise_sso: menuIcon('M13 9a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM11 13l8 8M14 16l3-3M17 19l3-3'),
  security: menuIcon(shield),
  stacks: menuIcon(cube),
  capacity: menuIcon(layers),
  agent: menuIcon('M5 7h14v11H5ZM12 3v4M2 11v4M22 11v4M9 18v3M15 18v3M9 11v2M15 11v2'),
  bundle: menuIcon(cube),
  mcp_servers: menuIcon(plug),
  api_resources: menuIcon(terminal),
  roles: menuIcon(shield),
  organization_template: menuIcon(users),
  organizations: menuIcon(users),
  users: menuIcon(users),
  actions: menuIcon(terminal),
  customize_jwt: menuIcon(terminal),
  webhooks: menuIcon(plug),
  audit_logs: menuIcon(terminal),
  tenant_settings: menuIcon(settings),
} satisfies Record<string, FC>;
