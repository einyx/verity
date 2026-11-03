# Managed MCP portal hosting

The deployment can set `MCP_PORTAL_MANAGED_DOMAIN=meshx.foundation` to give every
tenant automatic, single-level portal hostnames. Managed hosting is currently an
in-development feature and requires the instance's dev features to be enabled.

Creating a portal with only a name produces an address such as
`engineering-12ab34cd-mcp.meshx.foundation`. An explicit `subdomain: engineering`
instead requests `engineering-mcp.meshx.foundation`. Hostnames remain globally
unique; explicit collisions return the existing conflict response. The deployment
domain cannot be changed by a tenant. Existing portals are never renamed.

## Shared infrastructure

Provision once through Flux, not once per portal:

- A proxied wildcard DNS A record `*.meshx.foundation` points at the ingress
  address. Explicit records (console, authentication, etc.) retain precedence.
- Cloudflare Universal SSL covers these one-label hostnames at the edge.
- The existing Foundation gateway serves the origin wildcard certificate.
  Include `*.meshx.foundation` in its certificate SANs. Do not list
  `demo.meshx.foundation` separately when that wildcard is present: ACME rejects
  the redundant name. Keep `*.demo.meshx.foundation` for nested demo hosts.
- A VirtualService matches only single-level DNS labels ending in `-mcp`, then
  routes to Logto. No second wildcard Gateway is needed or should be created.
- Logto resolves the registered portal hostname through its tenant-scoped store.
  A DNS name without a registered portal does not become a portal by resolving.

The Flux implementation lives under
`apps/foundation/auth-tenants/demo-azure/managed-mcp.yaml`; the owning Kubo
HelmRelease sets the managed domain and image. Updating only the child Logto
release is not durable because the Kubo operator reconciles it.

## Readiness

The console polls the authenticated management route
`GET /api/mcp-portal/portals/:portalId/hosting`. Only portals present in the
current tenant's store can be checked. The probe is restricted to the
deployment's managed domain and suffix, follows no redirects, sends no tokens,
requires valid HTTPS, bounds the response to 8 KiB and times out after five
seconds. Discovery must advertise that exact portal's MCP resource URL.

`ready` means DNS, HTTPS and discovery routing work. It does not grant access to
organizations or certify upstream availability. New portals continue to deny
access until an administrator grants organizations. Failures stay `pending`;
legacy custom domains are `unmanaged` and are never fetched by this route.

## Compatibility

Without the managed domain configuration, existing tenant base-domain settings,
explicit subdomain requests, custom portals and conflict semantics are unchanged.
Legacy creation still requires a subdomain. No tenant receives Kubernetes or
Cloudflare credentials, and no new infrastructure is created per portal.
