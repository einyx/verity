# Development tenant deletion

The admin Cloud API implements `DELETE /api/tenants/:tenantId` for development
identity tenants. The existing Console confirmation flow calls this URL; a
successful operation returns204 and removes the tenant from the user's list.
The API contract is [tenant-deletion.openapi.json](api/tenant-deletion.openapi.json).

## Authorization and protected targets

The endpoint verifies the instance admin issuer, Cloud API audience and scope,
requires a user rather than a machine token, and rechecks the active console
identity, global access policy and target `manage:tenant` permission inside the
database transaction. Knowing a tenant ID is not sufficient. Tenant A's admin
cannot delete Tenant B without the corresponding permission.

`admin` and `default` cannot be deleted, including by an instance operator.
Production and unknown tags return409 (`billing_clearance_required`): the host
does not yet own authoritative production billing/retention teardown. Console
plan hints and cached subscription data are never treated as deletion clearance.
Conversion and deletion serialize on the target metadata row.

## Atomic cleanup

The transaction removes the target's console organization/memberships, tenant
row and FK-cascaded identity data, explicitly tenant-qualified operational
telemetry, and dedicated PostgreSQL role. A minimal actor/target success audit
record is retained in the admin service logs. The role must match the database/
tenant naming convention, fit PostgreSQL's identifier limit and have no
privileged capabilities. Unexpected ownership/grants cause role removal to fail
and the transaction to roll back; no `DROP OWNED`, schema/database drop, forced
session termination or broad cleanup is performed.

Other tenants, protected system data and external Kubo workloads/storage remain
unchanged. Billing records and external systems are outside this operation;
this is not a claim of GDPR erasure across those systems. Public cached data and
already-running telemetry jobs remain subject to their existing retention.
New tenant requests check authoritative existence before using an old cached
instance, including the acquisition retry-limit fallback, on every replica and
without relying on Redis invalidation. This adds
one indexed shared-database lookup for non-protected tenants. Lookup failure
fails closed. Requests already acquired at deletion time may finish; externally
cached JWTs remain cryptographically valid until their expiry but are not a
reason for the deleted tenant to keep serving new requests.

## Release and recovery

Deploy only after the database and authorization regressions pass. Do not use a
real customer's tenant as a deployment test. Take and verify the appropriate
backup before any intended live deletion: rolling back the application image
can disable future deletion, but cannot undo a committed operation.

Role-dependency failures return a generic503 without raw database diagnostics.
Connection loss during commit can make the outcome unknown; read the tenant
state/list before retrying. Repeating deletion of a removed tenant returns404.

## Isolated database regression suite

The suite accepts only an explicit `TENANT_DELETION_TEST_DATABASE_URL` using
`postgres://...@127.0.0.1:58126/verity_tenant_delete_test` without URL options.
Create a fresh, owned local PostgreSQL cluster/database at that endpoint, then:

```sh
TENANT_DELETION_TEST_DATABASE_URL=postgres://test-user@127.0.0.1:58126/verity_tenant_delete_test \
  pnpm --filter @logto/core test --runInBand --runTestsByPath \
  build/routes/cloud-tenant-deletion.test.js build/routes/cloud-tenants.test.js \
  build/tenants/Tenant.test.js
```

The fixture seeds the actual project schema into an empty dedicated database,
marks its ownership, then provisions new isolated tenants for each case. It
refuses unmarked populated databases and never reads production connection URLs.
It covers cleanup/rollback, cross-tenant and token failures, protected targets,
role safety, concurrent conversion and duplicate deletion. Without the explicit
test URL, only the real-database cases are skipped; the unauthenticated route
and cached-tenant fail-closed unit regressions still run in ordinary core tests.
Stop only the owned fixture PostgreSQL process when finished.
