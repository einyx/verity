# Foundation viewer email claims

`scripts/foundation-viewer-claims.js` adds standard `email` and `email_verified`
claims only to human access tokens for `https://demo.meshx.foundation/`. It uses
Logto's server-owned primary email, with the same verification semantics as its
built-in OIDC email claim. Missing email, suspended accounts, mismatched subjects,
machine credentials and other audiences receive no additional claims.

## Runtime and trust boundary

Cloud customizers still use the configured remote sandbox by default. A deployment
may allow exactly one reviewed script to use the existing bounded local worker:

- `TRUSTED_JWT_CUSTOMIZER_TENANT_ID`: exact owning tenant, `default` for the bare
  `auth.meshx.foundation` host.
- `TRUSTED_JWT_CUSTOMIZER_SHA256`: SHA-256 of the exact script bytes.

Both must match. Changing the script or its tenant uses the remote path instead.
The custom-JWT plan entitlement is checked before either execution path. This
does not change billing or disable authentication checks.

**Local workers are not a security sandbox.** Only deployment-reviewed code may
be allowlisted. Never select a hash supplied by a tenant or enable general local
execution of tenant-authored scripts. Tenant data stays input data, not code.
Other tenants, customizers and Actions retain their existing runtime selection.

## Release and verification

1. Retain the current Logto image, deployment values, customizer configuration and
   the owning tenant's current `customJwtEnabled` value as private rollback snapshots.
2. Deploy the matching reviewed image and the two allowlist settings. No schema
   changes are needed. Use the normal rolling readiness checks before proceeding.
3. Enable only `customJwtEnabled` for that tenant if needed. Preserve the plan,
   charges, Stripe identifiers and every other quota. Restarted pods clear cached
   entitlements; do not assume an older pod sees the new entitlement immediately.
4. Pass the provider's `/api/configs/jwt-customizer/test` for the Foundation viewer,
   other audience, missing email, suspended account and subject mismatch cases.
5. Preserve existing customization. If none exists, install this script as the
   access-token customizer with `blockIssuanceOnError: true`. Read it back and
   verify the exact bytes and tenant. Leave client-credentials customization alone.
6. Verify discovery and JWKS remain healthy. Newly issued viewer tokens acquire
   the claims; existing tokens are unchanged. Provider script tests are not a
   substitute for a real authenticated viewer flow.

The test script uses only ephemeral synthetic inputs to the provider's supported
test endpoint. It must not create production users, sessions or fixture tokens.

## Rollback

First restore the previous access-token customizer. When it was absent, remove
only the newly installed matching script; never delete a subsequent user's edit.
Then restore the previous allowlist settings, image and original entitlement.
Keep `IS_CLOUD`, billing and every unrelated setting unchanged. Verify ready pods
and OIDC discovery again. Already issued tokens remain valid until expiry;
rollback does not revoke them. V1 rollout is separate and is not part of this change.

## Checks

Run `node --test .scripts/foundation-viewer-claims.test.cjs`, the core customizer
route/runtime suites and the local-worker suite. Coverage must include exact
tenant/hash selection, mismatched tenant/hash rejection and unchanged plan gating.
