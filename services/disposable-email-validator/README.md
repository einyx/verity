# Owned disposable-email validator

Status: **service deployed, consumer wiring paused on a live policy-state conflict**. See `RELEASE.md` for immutable image, commits, canaries, and the exact decision needed. This service is separate from Logto's image and requires no Azure Function or public endpoint.

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

The identity platform service owner reviews dataset updates **monthly** using a pull request: inspect upstream provenance/license and removed/added domains, pin the exact package, update lockfile and dataset SHA, run all tests and npm audit, then rebuild and pin a new image digest. Review `reviewedAt` and `expiresAt` explicitly; never extend expiry without dataset review. No startup downloads and no unattended list changes. The current review expires **2027-02-01 UTC**. Schedule the next review by **2026-12-02** and arrange the existing alerting surface to notify the service owner before activation; alert provisioning has not been verified in this task.

Missing, corrupted, mismatched, or expired data makes readiness fail and classification return 503, **never false**. Liveness remains healthy to distinguish data maintenance from a process crash. Logto fails closed only when an administrator has explicitly enabled disposable blocking; disabled-policy login does not call the validator. No policy is enabled, no tenant records/defaults change, and no failed save is replayed by deployment.

## Tests and reproducible build

```
npm ci --ignore-scripts
npm test
npm audit --audit-level=low
docker build --platform linux/amd64 -t <owned-registry-tag> .
```

The Docker base is pinned by digest. Tests use synthetic addresses only, including the real TLS transport with ephemeral local test certificates. Core consumer tests explicitly override both test flags to exercise the actual HTTP branch, save guard, key/header/body contract, malformed/error responses, and timeout. No root-workspace symlink or private-package stub is required.

## Release gates and rollback

Authoritative GitOps: `meshxdata/flux`, demo overlay `apps/foundation/kubo/overlays/meshx/demo-azure/kustomization.yaml`; not the stale Logto base image. Service resources are registered under `apps/foundation/disposable-email-validator/demo-azure`. The consumer patch remains intentionally **inactive**.

1. Provision the key through `provision-key.py --provision`, which reuses the existing five-minute Kubernetes seed role, restricts its operations to the dedicated KV v2 data/metadata paths, uses CAS0, and requires self-revocation. This was independently reviewed and completed with version 1. No root/unseal credentials or ACS files are needed. ESO maps property `key` into `auth/disposable-email-validator:key`. Generate directly into Vault; expose only success/path/version metadata.
2. Obtain independent security/code/infrastructure approval, including the dependency lock, dataset provenance, update process, and TLS/NetworkPolicy probes. Resolve findings before deployment.
3. Build linux/amd64, push an immutable image, record digest/commit, replace the `unreleased` image gate, and commit the source and isolated GitOps branch. Serialize any main-branch update against the concurrent account-center release; fetch current remote immediately before integration. Do not replace its image pin.
4. Register the service's Flux Kustomization only after the writer/review gates. Wait for ESO, certificate, and **two ready service replicas**. Verify trusted TLS, anonymous and bad-key 401, synthetic disposable true/non-disposable false, strict response shape, source isolation, and zero request/email/credential logs. A canary can run inside a Logto pod with the mounted key read internally; never print the key. Do not save production policy as a test.
5. Publish only the certificate's **public CA** as GitOps ConfigMap `auth/logto-disposable-validator-ca`, key `ca.crt`. Confirm the deployed chart supports `caConfigMap`. Apply the separate inactive `logto-config.patch.yaml` to the demo overlay only after canary approval; it adds endpoint/key secretref and CA mount, never changes image, Cloud mode, account-center release, or policy flags. Verify both Logto replicas ready and env **names/ref metadata only**.
6. Monitor existing login health without sending messages or actual user addresses to external services. **Do not assume the live policy is disabled**: the final read-only check found default enabled, admin disabled. Preserve stored records and obtain an explicit decision before connecting the consumer.

Rollback the consumer first if it has been activated: remove only the three additions in `logto-config.patch.yaml`, preserve the concurrent release image and other env, reconcile and verify two Logto replicas. The missing-endpoint save guard remains. This is the first service release; there is no prior service image. Its safe rollback is removal of only its Flux registration/resources while consumer configuration is absent. Do not remove the dedicated Vault key without separate authorization. For future service updates record the prior immutable digest/dataset commit (only usable while fresh). Never install an always-false fallback.
