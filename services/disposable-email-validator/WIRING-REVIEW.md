# Independent consumer configuration review

## PASS — scoped dependency configuration only

Based on the supplied manifests and reported evidence; no tools, agents, edits, or live verification performed. This approves the proposed change, **not confirmation that activation succeeded**.

The patch references an ESO-backed key without exposing its value, uses verified internal TLS, and contains no policy writes or image changes. Repairing the dependency for the already-enabled default policy is intentional. Preserve stored flags exactly: **default=true, admin=false, other=false**.

### Required activation gates

- **Validate against the latest overlay:** ensure `extraEnv` exists as an array, neither new variable already exists, and `caConfigMap` does not replace an existing required trust bundle. JSON Patch `add` can replace an existing object member.
- **Preserve concurrent changes:** rendered diff must retain the stated current image digest and every existing environment entry. Append only the reviewed dependency configuration after fast-forward/rebase.
- **Confirm prerequisites:** Bundle successfully synced into `auth`, ConfigMap contains the expected public CA, ESO Secret is ready, and a fresh service canary passes before consumer rollout.
- **Verify both Logto replicas:** environment names/Secret references only, certificate-verified runtime TLS, synthetic classification, and unchanged read-only policy hash. Do not print secret values.

### Operational findings

- **CA rotation needs a restart mechanism.** ConfigMap projection updates alone do not reload Node’s `NODE_EXTRA_CA_CERTS`. Confirm a documented Logto rollout/restart procedure for trust changes. This is not a blocker for initial activation with the verified CA.
- **Trust is process-wide.** Adding the internal CA extends trust for Node TLS clients using the default trust configuration, not solely this endpoint. Keep CA-source and target-ConfigMap write permissions tightly scoped.
- Kubernetes HTTPS probes establish health, **not certificate identity**; retain the runtime verified-TLS canary as the security gate.

### Rollback implications

Revert only these dependency additions through GitOps, preserving image pins, unrelated environment settings, and all stored policies. Removing configuration can restore dependency failure and therefore block affected operations under the existing fail-closed policy; it does **not** disable that policy.

Keep the CA ConfigMap until the consumer rollback finishes. Avoid blindly rolling back the entire Helm release, which could undo concurrent worker changes.

Replica-local quotas and missing advanced alerting remain acknowledged residual risks, not resolved by this approval.

[0m
> plan · gpt-6.1-sol
