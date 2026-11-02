# Release evidence — 2026-11-02

## Outcome and exact blocker

**Owned validator deployed and healthy; Logto wiring intentionally not deployed.** No pending build, provisioning, review, or rollout jobs remain from this task.

The read-only pre-wiring database check found three policies: default tenant **disposable blocking true**, admin **false**, other tenant **false**. This conflicts with the requested combination of “policy remains disabled” and “actual stored flags remain unchanged.” No database writes or policy saves were performed. The policy-state aggregate hash remained `75a7b7420139f355dc0ce06a43a34879` before/after these checks.

Required decision: **preserve the already-enabled default policy and wire its validator, or explicitly authorize disabling default disposable blocking before wiring**. The inactive patch must not be applied until this conflict is resolved. No failed save was replayed.

## Sources, isolated worktrees, and commits

- Core/service worktree: `/Users/alessio/.local/share/opencode/worktree/4c92b8/owned-disposable-validator`, branch `fix/owned-disposable-validator`, based on remote `110d8fe60ce62c0e1a72806e637005d9a538a124`.
- Pushed source commits in `einyx/verity` (existing remote redirects from `einyx/logto`): `c0fe959e46f8591ba2a0e500cc53d532d2792667` (service and consumer tests/timeout) and `15d5508cf` (architecture-specific pinned base).
- Infra worktree: `/Users/alessio/code/foundation/flux-owned-disposable-validator`, branch `fix/owned-disposable-validator`.
- `meshxdata/flux` main commits: `b974b36aa7aecd7b867ae9f1ac24f723bac989e5` (service resources), `dbae810a43cfce8009111b553fc53e55180a0e83` (Flux registration).
- Main integration used fetch/rebase followed by normal fast-forward push; no force push or stale-base replacement. The concurrent account-center image was never changed by this task. Other worktrees and unrelated untracked work were left alone.

## Deployed state

Context `az-vel-app-data-demo-uaen-aks-1.mahi-tortoise.ts.net`, namespace `auth`:

- Deployment `disposable-email-validator`: **2/2 ready**.
- Immutable linux/amd64 image: `meshxregistry.azurecr.io/kubo/disposable-email-validator:15d5508cf@sha256:af82dcf0839da31879807fdc7a755e5a138ba45e8ca493e02124d167b75636e1`.
- Certificate `disposable-email-validator`: **Ready**, existing `internal-ca-cluster-issuer`.
- ExternalSecret `disposable-email-validator`: **Ready**, existing ClusterSecretStore `vault-secretsmanager`, target Secret `disposable-email-validator`, property `key`.
- Dedicated Vault KV2 key path: `secret/auth/disposable-email-validator`, **version 1**. Random generation and write happened entirely inside the provisioning tool process. CAS0 avoided overwrite; seed token was revoked and port-forward terminated.
- Private ClusterIP/TLS only; no public DNS/ingress/LoadBalancer or Azure Function created. No new paid Azure resources.
- Flux `foundation-disposable-email-validator` reconciled `dbae810a43cfce8009111b553fc53e55180a0e83` successfully.

Logto remains **2/2 ready** on the concurrent release's image:
`meshxregistry.azurecr.io/kubo/logto:account-center-29dfb3a39-20261102@sha256:d243225c14ceb1a9ad063f599cb941abba88d45be54ce940fb6e461d670a8089`.

`AZURE_FUNCTION_APP_ENDPOINT` and `AZURE_FUNCTION_APP_KEY` remain **absent**. No CA ConfigMap or Logto env/mount modifications were activated. Cloud/account/tenant configuration and endpoint-presence save guard remain untouched. The core timeout change is pushed source only, **not present in a newly deployed Logto image**; no unrelated Slack/ACS/AI/SSO code was shipped by this task.

## Verification

- Real `pnpm install --frozen-lockfile`, including normal lifecycle hooks and actual private dependency resolution; no workspace-root symlink/stubs.
- Service `npm test`: **11 passed**, covering authentication, normalization/IDNA/exact-domain/suffix confusion, valid providers, malformed JSON/schema/content/charset/body limit, stale/corrupt/mismatched data, pre-auth/auth rate ceilings, and actual TLS stalled handshake/headers/body deadlines.
- Service `npm audit --audit-level=low`: **0 vulnerabilities**.
- Core full `pnpm --filter @logto/core test --runInBand`: **390 suites passed, 1 skipped; 4,209 tests passed, 43 skipped**. Existing Node/OIDC and listener warnings were emitted. An earlier full run timed out at 120 seconds; this completed rerun took 191.963 seconds.
- Relevant remote-consumer tests explicitly set both `isUnitTest` and `isIntegrationTest` false, exercising the real HTTP branch, headers/JSON/endpoint, malformed/error responses, disabled-policy bypass, configured save, missing-endpoint save guard, and timeout.
- Core typecheck passed. Full core lint passed with **0 errors, 37 existing warnings**. Normal precommit secret scanning, lint-staged typecheck/lint, and commit-msg validation passed; no hooks bypassed.
- Core local hash build passed; `packages/core/build/main-EK4LBVA7.js` SHA256 `1b8de9729d80d6c77e19c76b2fed0be0c97bb3b419d9b0b1910b27761ac39f57`.
- Kubernetes server-side dry-run passed before service registration.
- Independent source security/code/infrastructure review: **PASS with non-blocking residuals**, after fixing all three medium initial findings. Independent bootstrap security re-review: **PASS** after disabling proxies/redirects, confirming owned port-forward binding, and correcting token-lifetime/revocation handling. Reports: `REVIEW.md`, `PROVISION-REVIEW.md`.

Live canary from an existing Logto pod, using key/CA internally without printing either:

- Trusted certificate/hostname validation **passed**.
- Anonymous and wrong key: **401**, strict generic unauthorized shape.
- Synthetic disposable: **true**, synthetic legitimate: **false**, strict boolean-only contract.
- Non-Logto foundation pod could not complete TLS/HTTP to validator. A preliminary TCP-only check established a local connection but was not sufficient isolation evidence; the actual TLS/HTTP check was denied. Do not use bare TCP connect as the security assertion in this cluster.
- Validator-to-existing-Vault egress probe **denied**.
- Combined validator stdout/stderr log size after canaries: **0 bytes**.
- No real addresses, SMS, email, Slack, notifications, or policy saves used as tests.

## Maintenance, residuals, and rollback

Dataset provenance/license and the exact source/package hash are in `dataset.json`; reviewed snapshot has 8,883 domains, expiry **2027-02-01 UTC**, next monthly review due **2026-12-02**. Missing/stale/corrupt data fails readiness and returns 503, never an always-false result. Monthly reviewed updates, source license checks, lock/digest pinning and rollback steps are in `README.md`. Alert ownership/advance-expiry alert setup remains an activation gate, not a claimed completed integration.

Residual availability tradeoff: pre-auth quota is shared per replica, so a permitted compromised caller can consume it. Two replicas do not provide a distributed global quota. Record acceptance or add caller-specific limits before activation if that tradeoff is unacceptable.

No prior validator image exists. While consumer config remains absent, rollback removes only the new validator Flux registration/resources through GitOps; do not touch Logto image/policies or delete the Vault key without authorization. If consumer wiring is later activated, roll it back first by removing only the three inactive patch additions, preserving the concurrent release pin, and verify two ready Logto replicas.

Security incident: an overbroad Vault-CR auth-metadata discovery query unexpectedly returned an unrelated existing OIDC credential into tool output. It was not used, copied into source, or repeated in reports. Treat that credential as exposed and rotate through the normal credential-owner process; no unauthorized rotation was attempted. ACS credential files were never opened.
