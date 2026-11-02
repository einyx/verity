# Owned disposable-email validator

Status: **DEPLOYED — service and Logto dependency configuration verified**. Existing stored flags are preserved: default true, admin false, other tenant false. See `RELEASE.md` for immutable images, GitOps commits, canaries, limitations, and rollback. This service is separate from Logto's image and requires no Azure Function or public endpoint.

## Contract and boundaries

`POST /api/disposable-email-domain-validation`, JSON `{ "email": "synthetic@example.com" }`, header `x-functions-key`, returns `{ "isDisposable": false }`. The address is received only inside the owned cluster over TLS; it is never forwarded, persisted, or logged. Only its normalized lowercase IDNA domain is looked up. Matching is **exact domain**, not parent/suffix matching, following the maintained package. Subdomains are blocked only when explicitly listed. Gmail/Outlook and suffix-confusion regression tests protect legitimate providers.

Production listens on TLS port 8443 only; private ClusterIP is 443. The certificate uses the existing internal CA. No ingress, LoadBalancer, DNS publication, or external API is needed. NetworkPolicy admits only same-namespace pods labeled `app=logto`, and denies all validator egress. Azure NPM is installed; auth had no additive NetworkPolicies at inspection. Verify these assumptions and a denied-source probe before activation.

Limits per replica: 1 KiB uncompressed JSON, 8 KiB headers, two-second TLS handshake, five-second headers/body/socket inactivity, 1,200 requests/minute pre-auth and 600 requests/minute authenticated. Two replicas double the aggregate ceilings; this is not a distributed quota. Invalid credentials receive 401; throttling 429; malformed JSON/schema 400; unsupported content 415; oversized body 413; unavailable/stale dataset 503. Responses are noncacheable. No request/access/error logger is installed, and errors are generic. Infrastructure must not enable body/header capture, tracing payload capture, or TLS termination/access logging ahead of this ClusterIP.

The shared key is 32 random bytes encoded as 64 lowercase hexadecimal characters. It is mounted from a dedicated ESO Secret, never baked into an image or placed in arguments. Reloader restarts the service on key/certificate changes. Rotate the server and consumer together under a maintenance procedure; a mismatched key fails closed.

## Dataset, license, maintenance

- Maintained package `disposable-email-domains-js@1.26.0`, exact npm lockfile integrity; package and underlying dataset are **CC0-1.0**.
- Package source: commit `83534395df76bff1cae597540fd4402d0d1c4d45`.
- Underlying data submodule: `martenson/disposable-email-domains@be0dd1affed11ea9b1ffcd14da81319f9a080609`; its `LICENSE.txt` explicitly permits commercial reuse.
- Verified source JSON and installed package JSON SHA-256: `4bc4c52a1d89848ff75ce569714eab38e47d87e57612d530f1d3821036091bd3`, 8,883 entries.
- Upstream licenses remain distributed in installed `node_modules`; see `dataset.json` for permanent source/license links. The service introduces no custom domain-list parser; it uses the maintained package's Set and verifies its serialized contents against the same digest.

The identity platform service owner reviews dataset updates **monthly** using a pull request: inspect upstream provenance/license and removed/added domains, pin the exact package, update lockfile and dataset SHA, run all tests and npm audit, then rebuild and pin a new image digest. Review `reviewedAt` and `expiresAt` explicitly; never extend expiry without dataset review. No startup downloads and no unattended list changes. The current review expires **2027-02-01 UTC**; next monthly review is due **2026-12-02**. Advance-expiry alerting is an operational follow-up, not a claimed completed integration; this deployment relies on the documented monthly review and fail-closed expiry behavior.

Missing, corrupted, mismatched, or expired data makes readiness fail and classification return 503, **never false**. Liveness remains healthy to distinguish data maintenance from a process crash. Logto fails closed only when disposable blocking is enabled; disabled-policy login does not call the validator. Deployment performs no policy writes, changes no tenant records/defaults, and replays no failed save. The already-enabled default policy is intentionally repaired by supplying its missing dependency; it is not toggled off or newly enabled.

## Tests and reproducible build

```
npm ci --ignore-scripts
npm test
npm audit --audit-level=low
docker build --platform linux/amd64 -t <owned-registry-tag> .
```

The Docker base is pinned by digest. Tests use synthetic addresses only, including the real TLS transport with ephemeral local test certificates. Core consumer tests explicitly override both test flags to exercise the actual HTTP branch, save guard, key/header/body contract, malformed/error responses, and timeout. No root-workspace symlink or private-package stub is required.

## Release gates and rollback

Authoritative GitOps: `meshxdata/flux`, demo overlay `apps/foundation/kubo/overlays/meshx/demo-azure/kustomization.yaml`; not the stale Logto base image. Service resources are registered under `apps/foundation/disposable-email-validator/demo-azure`. Consumer additions are active inline in the Kubo overlay. `logto-config.patch.yaml` is reference-only: do not apply it a second time and duplicate env entries.

1. Provision the key through `provision-key.py --provision`, which reuses the existing five-minute Kubernetes seed role, restricts its operations to the dedicated KV v2 data/metadata paths, uses CAS0, and requires self-revocation. This was independently reviewed and completed with version 1. No root/unseal credentials or ACS files are needed. ESO maps property `key` into `auth/disposable-email-validator:key`. Generate directly into Vault; expose only success/path/version metadata.
2. Obtain independent security/code/infrastructure approval, including the dependency lock, dataset provenance, update process, and TLS/NetworkPolicy probes. Resolve findings before deployment.
3. Build linux/amd64, push an immutable image, record digest/commit, replace the `unreleased` image gate, and commit the source and isolated GitOps branch. Serialize any main-branch update against the concurrent account-center release; fetch current remote immediately before integration. Do not replace its image pin.
4. Register the service's Flux Kustomization only after the writer/review gates. Wait for ESO, certificate, and **two ready service replicas**. Verify trusted TLS, anonymous and bad-key 401, synthetic disposable true/non-disposable false, strict response shape, source isolation, and zero request/email/credential logs. A canary can run inside a Logto pod with the mounted key read internally; never print the key. Do not save production policy as a test.
5. Distribute only the **public CA** with the GitOps-managed trust-manager Bundle `logto-disposable-validator-ca`, targeting ConfigMap `auth/logto-disposable-validator-ca`, key `ca.crt`. The deployed Logto chart 0.3.11 supports `caConfigMap`, mounts `/etc/kubo/ca`, and sets `NODE_EXTRA_CA_CERTS=/etc/kubo/ca/ca.crt`. After the Bundle is Synced and service canary passes, add the three reference additions inline in the demo overlay, preserving the current image, all existing env, Cloud mode, and policies. Verify both Logto replicas ready, env **names/ref metadata only**, and default Node TLS trust from both processes. Adding the CA extends process-wide trust for Node clients. Node reads extra CA trust at startup: deliberately roll Logto through its normal GitOps/Helm path after CA trust changes; a projected ConfigMap update alone does not reload Node trust. Coordinate key rotations with the same consumer rollout procedure.
6. Monitor existing login health without sending messages or actual user addresses to external services. **Do not assume the live policy is disabled**: default is enabled, admin and the other tenant are disabled. User/controller clarification explicitly authorized wiring the missing dependency while preserving these actual flags. Verify the read-only policy hash before/after; never toggle policy or replay a failed save as a test.

Rollback the consumer first: remove only the three active inline additions represented in `logto-config.patch.yaml`, preserve the latest concurrent release image and other env, reconcile and verify two Logto replicas. Do not roll back the entire Helm release. Keep the public CA ConfigMap until consumer rollback is finished. Stored default policy stays true: removing the dependency restores fail-closed failures for affected operations, not a disabled policy. The missing-endpoint save guard remains. This is the first service release; there is no prior service image. Its safe rollback is removal of only its Flux registration/resources after consumer configuration is absent. Do not remove the dedicated Vault key without separate authorization. For future service updates record the prior immutable digest/dataset commit (only usable while fresh). Never install an always-false fallback.
