# Verity

**Verity is the identity and admin platform for the meshX product suite.**

It is a multi-tenant auth and user-management platform rebuilt on top of the
[Logto](https://github.com/logto-io/logto) open-source core. The protocols are handled for you —
OIDC, OAuth 2.1, and SAML — and the product layer on top is meshX's own:

- **Multi-tenancy first** — every user, role, and connector lives inside a tenant. Workspace
  admins manage their own tenant in the console; a separate admin tenant manages the platform.
- **Invitation-based onboarding** — people join a tenant through signed invitations and set
  their own password on first sign-in. No shared secrets in the flow.
- **Ask AI** — admins ask the assistant to make changes (creating users, and more). It proposes
  the exact payload, and nothing happens until the admin confirms it in the console.
- **Enterprise auth, ready to use** — enterprise SSO, RBAC, and pre-built sign-in flows from
  the Logto core, no protocol plumbing required.

## Repository layout

A pnpm monorepo. The main packages:

| Package | What it is |
| --- | --- |
| `packages/core` | The OIDC provider and the admin/user APIs (Node.js, PostgreSQL) |
| `packages/console` | The admin console (React) |
| `packages/experience` | The sign-in experience app |
| `packages/account` | The end-user account app |
| `packages/connectors` | Social, email, and SMS connectors |

## Running it

Verity normally runs as part of the meshX platform stack in the parent repository
(`platform-compose`), which builds this checkout and runs Postgres alongside it:

```bash
# From the platform root (parent of this repo)
docker compose up                       # build and run verity + platform services
docker compose -f docker-compose.dev.yml up   # hot-reload overlay for core/console sources
```

The core API listens on port `3001` and the console on `3002`.

### Local development without Docker

Requires Node.js `^24.7.0 || ^26.0.0`, pnpm, and PostgreSQL.

```bash
pnpm i
pnpm dev
```

## Acknowledgements

Verity is a fork of [Logto](https://github.com/logto-io/logto), and we're grateful to the Logto
team and community — upstream remains the source of the core auth engine we build on.

## License

[MPL-2.0](LICENSE).
