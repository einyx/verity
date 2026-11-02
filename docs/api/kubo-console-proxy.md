# Authenticated Kubo console proxy

The tenant Management API exposes `/api/kubo/*`. Its existing bearer,
organization-membership/`all` scope and read-only guards still apply. MCP
`list_foundation_stacks` calls `/api/kubo/stacks` with the caller's bearer;
it does not call the portal directly.

## Scope and capability discovery

`GET /api/kubo/access[?scope=tenant|all]` returns only these booleans:

```json
{
  "canViewAll": true,
  "operator": false,
  "tenantScoped": true,
  "canMutate": false,
  "tenantMutationsEnabled": false
}
```

The default scope is always the selected console tenant, including for global
admins. `scope=all` requires an interactive user whose original bearer verifies
against **admin-only keys, issuer and console audience**, an unsuspended admin
user record, and the existing global admin role. A tenant key claiming the admin
issuer/audience, colliding user ID, development-header bypass or machine token
cannot establish that provenance. Email-domain privileges do not qualify.

`canViewAll` describes authorization to request `scope=all`; `operator` describes
the current request. `canMutate` is true only in authorized operator scope and
without read-only access. It is not permission to purge an assigned Namespace.
Tenant mutation capability is deliberately **false**: Kubo has no authenticated
policy-readiness discovery API. Do not enable tenant UI actions from a console
environment flag or a successful preview. A future readiness contract is needed
before this endpoint can advertise tenant mutations dynamically. Tenant API
writes still go through Kubo's authoritative, default-off policy check and return
503 when protection is unavailable; they are never translated into success.
Authoritative backend readiness discovery is pending controller integration:
Task 3 cannot yet satisfy the full tenant creation/action scope. This is not a
completed end-to-end rollout capability, and this slice invents no readiness API.

Global economics, capacity, agent archives, demo approval/rejection and airgap
uploads require explicit operator scope. There is no generic backend-path proxy.
Unsupported/new control surfaces are not tenant-authorized by default.

## Tenant provisioning and updates

Create accepts shipped builtin `full`/`lite`, `Direct` mode and `logto` provider.
The create body's `tenant` remains the Kubernetes DNS namespace slug. Ownership
is a separate server-derived `tenantId` in the signed context; submitted owner
fields are rejected, never trusted or substituted for the namespace slug.
Kubo verifies builtin source, namespace/Stack collisions and bindings on preview
and creation. Scoped patch accepts only existing-component `exclude` and
`featureFlags` (at most 128; keys `^[a-z][a-z0-9_]{0,63}$`; string values
`true`/`false`). Kubo checks existing component names. Other patch options require
operator scope. All backup APIs remain operator-only in the backend.

The proxy preserves upstream 400/401/403/404/409/413/503 without reflecting raw
errors. Missing and foreign coordinates remain indistinguishable 404s. Protected
responses use `Cache-Control: private, no-store`. Do not log credentials,
delegation proofs or request/response payloads.

## Deployment security contract (no rollout implied)

Both servers require `KUBO_CONSOLE_PROXY_KEY`: canonical standard-base64 encoding
of at least 32 random bytes, installed through the existing secret workflow.
Missing/malformed proxy configuration fails closed with 503. Never deploy the
public test fixture key. Backend/proxy must be coordinated; there is no unsigned
or unscoped compatibility fallback. Redirects are disabled and browser bearer,
cookies and incoming proof headers are never forwarded to Kubo.

Every protected request gets a newly constructed `X-Kubo-Console-Context` JWT:
HS256, `typ=JWT`, `iss=verity-console`, `aud=kubo-portal`, `sub=actorId`, selected
`tenantId`, explicit boolean `operator`, exact HTTP `method`, final encoded
pathname plus raw query (including an explicit empty `?`), lowercase SHA256
`bodySha256`, numeric seconds `iat` and `exp` (30-second lifetime). JSON writes
are bounded to 1 MiB and serialized once. Only operator `POST /api/airgap/bundle`
may stream with `UNSIGNED-PAYLOAD`.

Tenant mutation activation is Kubo's authority. Defaults are disabled. The
reviewed backend requires the actual expected
`kubo-console-namespace-binding` policy and
`kubo-console-namespace-binding-deny` Deny binding, exact specs and current,
warning-free type status, not merely a configuration assertion. Two-phase demo
rollout installs/verifies protection with writes disabled, performs separately
approved pinned ownership migration, then activates writes. No console request
may claim or override guard readiness.

Assigned Namespace ownership is immutable and Namespace deletion/purge is
maintenance-only, even for operators. Kubo denies purge before deleting a Stack;
Stack-only deletion remains supported. Retained Helm guard resources and pending
DemoRequest teardown require deliberate maintenance handling. The aggregate
portal/manager RBAC still has bind/escalate privilege: do not describe deployed
portal credentials as below policy-admin trust. No infrastructure, ownership,
secret or rollout operation is authorized by this source change.
