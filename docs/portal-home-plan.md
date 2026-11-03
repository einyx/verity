# MCP portal home page — plan

A human-facing, authenticated home page for each MCP portal host. Today the
portal host serves only the machine endpoints (`POST /mcp` and RFC 9728
discovery); all UI lives in the admin console. This adds the missing end-user
surface: visit `https://<portal-host>/`, sign in with the tenant issuer, and see
exactly the servers your organizations are granted, plus copy-paste connect
commands.

Disclosure model follows Cloudflare's MCP portals: **before sign-in, a visitor
sees only the portal name and a sign-in button** — no server names, no tool
counts. Everything is visible after authentication.

## Decisions

1. **Same process, portal-host-keyed routes.** Core already routes by hostname
   in `mcp-portal-endpoint.ts`; the page rides the same lookup. The kubify
   chart's `mcp-portals.yaml` already sends `*.<baseDomain>` to Logto, so no
   infrastructure changes.
2. **Built-in first-party virtual client, PKCE, stateless.** Follow the
   built-in-client pattern in `oidc/adapter.ts` (demo app, account center): a
   virtual SPA client with no database row and no secret. Auth-code + PKCE
   against the tenant's `/oidc`; token held in browser memory; no refresh
   token; no server session — matching the stateless `/mcp` endpoint.
3. **Redirect-URI validation = portal lookup.** The client's redirect URI is
   `https://<portal-host>/callback`, validated by `portals.findByHostname`
   (tenant-scoped), never a blind wildcard. This is the main new security
   surface and gets dedicated tests.
4. **Minimal scopes.** `openid` plus organization claims only — no management
   API scopes, no upstream credentials. The page never mints MCP tokens; that
   stays the MCP client's OAuth flow.
5. **Shared grant logic.** The organization-grant matching that decides what a
   caller sees moves into `@logto/mcp-portal` so the protocol endpoint and the
   home page cannot drift.

## PR breakdown

### PR 1 — `@logto/mcp-portal`: shared grant and home data logic

- `grants.ts`: `visibleUpstream()` (extracted from `portal.ts` `canSee`) and
  `grantedOrganizations()` (extracted from `mcp-portal-endpoint.ts`), both with
  injectable audit/logging and unit tests.
- `home.ts`: `portalConnectCommands()` (the Claude Code / Codex / OpenCode
  command templates, moved from the console's `PortalConnect.tsx`) and
  `portalHomeData()` — pure assembly of upstream metadata an authenticated
  caller may see. No credentials, no upstream URLs.
- Core's endpoint re-imports the extracted functions; no behavior change.

### PR 2 — core: the page and its endpoints

Behind `isDevFeaturesEnabled`, guarded with a comment naming the "MCP portal
home page" feature:

- `routes/mcp-portal-home.ts` on the anonymous router:
  - `GET /` — portal host only; pre-auth page shows name + sign-in.
  - `GET /callback` — same asset; the page completes the PKCE exchange.
  - `GET /mcp-home` (JSON, bearer token validated via userinfo): granted
    servers and connect commands from PR 1 helpers.
- Built-in client metadata for the virtual SPA client in `oidc/adapter.ts`,
  with redirect validation via portal lookup.
- OpenAPI: extend `mcp-portal.openapi.json`, operations tagged
  `["Dev feature"]`.
- Route tests mirroring `mcp-portal-endpoint.test.ts`, plus redirect abuse
  tests (unknown host, cross-tenant host, plain-http scheme).
- Phrases entries with all locales synced in the same PR.

### PR 3 — console: link out

- `PortalConnect.tsx`: an "Open portal home" link to `https://<host>/`. No
  iframe, to avoid CSP/frame-ancestors coupling.

### PR 4 — release

- Remove only this feature's `isDevFeaturesEnabled` guard and add the
  changeset (flag and changeset never ship together).

## Risks and open questions

- Wildcard redirect validation is the one genuinely new attack surface:
  tenant-scoped portal lookup, dedicated tests, and `portal.access` audit
  entries (outcome `denied`) like the protocol endpoint.
- `GET /mcp` with `Accept: text/html` could redirect browsers to `/` instead
  of 405 (Cloudflare-style). The HTTP binding expects 405 for GET, so this
  stays optional and flag-guarded.
- The page must never render upstream credentials or
  `MCP_PORTAL_ENCRYPTION_KEY` material; `portalHomeData()` returns only names
  and metadata.

## Local verification

Start the compose stack, create a portal in the console on `:3003`, map its
hostname to `127.0.0.1`, then check: anonymous `GET https://<host>/` shows
sign-in only; an authenticated member sees only their organizations' servers;
the OpenCode snippet from the page connects through `POST /mcp` and lists
tools.
