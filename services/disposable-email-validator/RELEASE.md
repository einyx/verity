# Release evidence — 2026-11-02

## Outcome — DEPLOYED

**Owned validator and Logto dependency wiring are deployed and verified.** Both deployments have two updated/ready replicas; all commands, tests, reviews, and rollouts launched by this task have finished.

The read-only pre-/post-wiring database checks found three policies: default tenant **disposable blocking true**, admin **false**, other tenant **false**. All stayed exactly unchanged. The policy-state aggregate hash remained `75a7b7420139f355dc0ce06a43a34879` before/after deployment.

The earlier pause was resolved by explicit controller/user clarification: preserve **actual** stored flags; supplying the missing dependency for the already-enabled default policy is the intended repair. No database writes, policy toggles, signup tests, or policy saves were performed. No failed save was replayed. Do not describe the default policy as disabled.

## Sources, isolated worktrees, and commits

- Core/service worktree: `/Users/alessio/.local/share/opencode/worktree/4c92b8/owned-disposable-validator`, branch `fix/owned-disposable-validator`, based on remote `110d8fe60ce62c0e1a72806e637005d9a538a124`.
- Pushed source commits in `einyx/verity` (existing remote redirects from `einyx/logto`): `c0fe959e46f8591ba2a0e500cc53d532d2792667` (service and consumer tests/timeout) and `15d5508cf` (architecture-specific pinned base).
- Infra worktree: `/Users/alessio/code/foundation/flux-owned-disposable-validator`, branch `fix/owned-disposable-validator`.
- `meshxdata/flux` main commits: `b974b36aa7aecd7b867ae9f1ac24f723bac989e5` (service resources), `dbae810a43cfce8009111b553fc53e55180a0e83` (Flux registration).
- Configuration release commits on `meshxdata/flux` main: `2e35be1d88979d7124a307b892dfbb2c7d02a308` (public CA Bundle), `39f8c94c9772fe9c333efadd888ee4446a7e2ab2` (consumer wiring).
- Main integration used fetch/rebase followed by normal fast-forward push; no force push or stale-base replacement. The concurrent account-center image was never changed by this task. Other worktrees and unrelated untracked work were left alone.
- Source master was freshly checked at `9ed74448e74124b61d058c18b69c08727a0c1865` before activation; a final fetch observed the unrelated Slack merge `7978db204376360abeef07b449a59c01f58bb5ab`. The validator/timeout source commits remain on the pushed feature branch, not merged into master. No new Logto image was built or deployed, so none of those concurrent source changes were bundled/shipped by this configuration-only release.

## Deployed state

Context `az-vel-app-data-demo-uaen-aks-1.mahi-tortoise.ts.net`, namespace `auth`:

- Deployment `disposable-email-validator`: **2/2 ready**.
- Immutable linux/amd64 image: `meshxregistry.azurecr.io/kubo/disposable-email-validator:15d5508cf@sha256:af82dcf0839da31879807fdc7a755e5a138ba45e8ca493e02124d167b75636e1`.
- Certificate `disposable-email-validator`: **Ready**, existing `internal-ca-cluster-issuer`.
- ExternalSecret `disposable-email-validator`: **Ready**, existing ClusterSecretStore `vault-secretsmanager`, target Secret `disposable-email-validator`, property `key`.
- Dedicated Vault KV2 key path: `secret/auth/disposable-email-validator`, **version 1**. Random generation and write happened entirely inside the provisioning tool process. CAS0 avoided overwrite; seed token was revoked and port-forward terminated.
- Private ClusterIP/TLS only; no public DNS/ingress/LoadBalancer or Azure Function created. No new paid Azure resources.
- Flux `foundation-disposable-email-validator` and `foundation-kubo` both Ready at revision `39f8c94c9772fe9c333efadd888ee4446a7e2ab2`.

Logto is **2/2 updated and ready**, generation **225** (was 224), on the unchanged concurrent release image:
`meshxregistry.azurecr.io/kubo/logto:account-center-29dfb3a39-20261102@sha256:d243225c14ceb1a9ad063f599cb941abba88d45be54ce940fb6e461d670a8089`.

Active consumer configuration:

- `AZURE_FUNCTION_APP_ENDPOINT=https://disposable-email-validator.auth.svc.cluster.local`.
- `AZURE_FUNCTION_APP_KEY` from Secret reference **`auth/disposable-email-validator`, key `key`**; value never printed or committed.
- `caConfigMap=logto-disposable-validator-ca`; synced public trust-manager Bundle targets the auth ConfigMap, mounts `/etc/kubo/ca/ca.crt`, and the chart sets `NODE_EXTRA_CA_CERTS` to that path.

All 16 prior extraEnv entries, image pin, and other Logto Helm values were preserved. Removing only the three intentional additions from post-release values gives the same pre-release values SHA256 `73065312873124d53298d58a5e8774333fd842fc618900519bd8354cb0d1a494`. Cloud/account/tenant settings and the endpoint-presence save guard remain intact. The core two-second timeout patch is pushed source only, **not deployed**; no unrelated Slack/ACS/AI/SSO code was shipped by this task.

## Verification

- Real `pnpm install --frozen-lockfile`, including normal lifecycle hooks and actual private dependency resolution; no workspace-root symlink/stubs.
- Service `npm test`: **11 passed**, including a fresh post-wiring rerun, covering authentication, normalization/IDNA/exact-domain/suffix confusion, valid providers, malformed JSON/schema/content/charset/body limit, stale/corrupt/mismatched data, pre-auth/auth rate ceilings, and actual TLS stalled handshake/headers/body deadlines.
- Service `npm audit --audit-level=low`: **0 vulnerabilities**.
- Prior core full `pnpm --filter @logto/core test --runInBand`: **390 suites passed, 1 skipped; 4,209 tests passed, 43 skipped**. Existing Node/OIDC and listener warnings were emitted. An earlier full run timed out at 120 seconds; this completed rerun took 191.963 seconds. This follow-up changed configuration/documentation only, not core code; it did not claim to retest or release concurrent source-master changes.
- Relevant remote-consumer tests explicitly set both `isUnitTest` and `isIntegrationTest` false, exercising the real HTTP branch, headers/JSON/endpoint, malformed/error responses, disabled-policy bypass, configured save, missing-endpoint save guard, and timeout.
- Core typecheck passed. Full core lint passed with **0 errors, 37 existing warnings**. Normal precommit secret scanning, lint-staged typecheck/lint, and commit-msg validation passed; no hooks bypassed.
- Core local hash build passed; `packages/core/build/main-EK4LBVA7.js` SHA256 `1b8de9729d80d6c77e19c76b2fed0be0c97bb3b419d9b0b1910b27761ac39f57`.
- Kubernetes server-side dry-run passed before service registration.
- Consumer configuration server-side dry-run passed. Render/live comparison before wiring proved only endpoint, key Secret reference, and CA name were added; all prior values were identical. Final pre-push check also compared the live Deployment image with the Helm/GitOps pin to avoid overwriting a concurrent release.
- Independent source security/code/infrastructure review: **PASS with non-blocking residuals**, after fixing all three medium initial findings. Independent bootstrap security re-review: **PASS** after disabling proxies/redirects, confirming owned port-forward binding, and correcting token-lifetime/revocation handling. Reports: `REVIEW.md`, `PROVISION-REVIEW.md`.
- Independent consumer configuration security/infrastructure review: **PASS**, `WIRING-REVIEW.md`. The actual deployed chart was inspected metadata-only: Logto chart **0.3.11**, template SHA256 `0d9347d7bbcb49ec21a0492417f84b8d404a097ab26282c22cdb417a7d8eafdb`, with confirmed CA ConfigMap/mount and Node extra-CA support. Public Bundle Synced before wiring; its CA matched the service issuer, public CA SHA256 `716758bd37e93628396bc55410e77190d7684f7c85a8d770c25b121461d3601c`.

Fresh pre-wiring canary and post-wiring canaries from **both** ready Logto replicas, using credentials internally without printing them:

- Trusted certificate/hostname validation **passed**.
- Anonymous and wrong key: **401**, strict generic unauthorized shape.
- Synthetic disposable: **true**, synthetic legitimate: **false**, strict boolean-only contract.
- Non-Logto foundation pod could not complete TLS/HTTP to validator. A preliminary TCP-only check established a local connection but was not sufficient isolation evidence; the actual TLS/HTTP check was denied. Do not use bare TCP connect as the security assertion in this cluster.
- Validator-to-existing-Vault egress probe **denied**.
- Combined validator stdout/stderr log size after canaries: **0 bytes**.
- Both new Logto processes used their actual env Secret reference and default Node extra-CA trust with **no explicit per-request CA override**. Each passed readiness 200, missing/bad-key 401, and synthetic disposable/non-disposable strict response checks. An additional smoke used the installed production `got` dependency with runtime env and automatic TLS trust; both classifications passed. The smoke harness bounds its own requests, not a claim that the source-only consumer timeout patch is deployed.
- The save-guard diagnostic string remains present in the deployed core bundle; no production policy save was used to test it.
- Core/admin root health probes returned **204 on both replicas**, as defined in `packages/core/src/app/init.ts`. An initial smoke incorrectly expected 200 and used `/console/` on the raw admin port (404); investigation confirmed root-probe semantics, and corrected `/` assertions passed. No application change was made for that test assumption, and this is not a claim of browser/UI validation of the concurrent outage-fix work.
- No real addresses, SMS, email, Slack, notifications, or policy saves used as tests.

## Maintenance, residuals, and rollback

Dataset provenance/license and the exact source/package hash are in `dataset.json`; reviewed snapshot has 8,883 domains, expiry **2027-02-01 UTC**, next monthly review due **2026-12-02**. Missing/stale/corrupt data fails readiness and returns 503, never an always-false result. Monthly reviewed updates, source license checks, lock/digest pinning and rollback steps are in `README.md`. Advance-expiry alert setup is an operational follow-up/limitation, not a claimed completed integration.

Residual availability tradeoff: pre-auth quota is shared per replica, so a permitted compromised caller can consume it. Two replicas do not provide a distributed global quota. Record acceptance or add caller-specific limits before activation if that tradeoff is unacceptable.

Rollback the consumer **first**: remove only the three inline dependency additions (represented by reference-only `logto-config.patch.yaml`) through latest-base GitOps, preserve current image/all other env and stored flags, reconcile and verify two ready Logto replicas. Do not blindly roll back the entire Helm release or an old image pin. Keep public CA resources until that rollback finishes. Default remains true: removing the dependency restores fail-closed failures for affected operations, not a disabled policy. Only afterward may the first-release validator resources/Flux registration be removed; there is no earlier service image. Do not delete the dedicated Vault key or alter stored policies without separate authorization.

Trust/key maintenance: trust-manager updates the public ConfigMap, but Node loads extra CA trust at startup; deliberately roll Logto using normal GitOps/Helm when trust changes. Adding the internal CA extends process-wide default Node trust, not only the validator client's trust. Coordinate key changes with both server and consumer; a mismatched key fails closed.

Security incident: an overbroad Vault-CR auth-metadata discovery query unexpectedly returned an unrelated existing OIDC credential into tool output. It was not used, copied into source, or repeated in reports. Treat that credential as exposed and rotate through the normal credential-owner process; no unauthorized rotation was attempted. ACS credential files were never opened.

## Self-evaluation

Service and scoped dependency configuration are deployed with verified runtime behavior and unchanged policies. Remaining operational limitations are explicit rather than claimed complete.

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4/5 | Both runtime canaries and read-only policy hash verify deployment boundaries; report distinguishes source-only timeout from deployed behavior. No browser/UI check of the unrelated concurrent release was performed. |
| Completeness | 4/5 | Dependency wiring, runtime trust, all replicas and flags are verified; advance-expiry alerts and shipping consumer timeout hardening remain explicit limitations. |
| Clarity | 4/5 | Exact image, commits, tests, and activation blocker are recorded; the long report is operationally dense. Keep the user-facing summary short. |
| Actionability | 4/5 | Inactive patch and exact two-way policy decision are provided; credential rotation still requires the normal owner workflow. |
| Conciseness | 3/5 | The report repeats some runbook details to make the handoff self-contained; use the outcome section for a quick read. |

Overall: **3.8/5**. Highest-impact follow-ups: rotate the exposed unrelated credential through its owner; establish advance-expiry alerts; separately release consumer timeout hardening without mixing concurrent unshipped features. The requested missing-dependency repair is deployed, not contingent on a policy toggle.
