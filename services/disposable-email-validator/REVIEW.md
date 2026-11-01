# Independent source re-review

## Source verdict: PASS — with non-blocking findings

Text-only review of the supplied source and inactive manifests. Reported test results and infrastructure observations are accepted as supplied, not independently verified. No tools, agents, or edits used.

The three previous findings are addressed:
- Dataset verification now checks the serialized contents of the **queried Set** against the verified file digest.
- TLS explicitly sets a **two-second handshake timeout**.
- A **pre-authentication limiter** precedes credential hashing/comparison and body parsing.

### Severity-ranked findings

**Medium — Shared pre-authentication quota permits availability interference**  
`services/disposable-email-validator/server.js`, `createApp`

Invalid-key requests consume the same 1,200-request/minute replica-local bucket as legitimate requests. A network-admitted caller can exhaust it and force authenticated clients to receive 429s.

This is a residual availability tradeoff, not missing pre-auth protection or an authentication bypass. Before activation, document acceptance and exercise legitimate traffic during a bad-key flood. If unacceptable, retain the aggregate ceiling while adding caller-specific admission controls.

**Low — TLS regression proves eventual closure, not each configured deadline**  
`services/disposable-email-validator/server.test.js`, production TLS test

The test waits for three connections to close within one 25-second test timeout. It does not independently assert the two-second handshake or five-second request bounds. Completely stalled requests also do not test periodic trickling that avoids socket inactivity.

Add per-case elapsed-time assertions with scheduling tolerance and trickled-header/body cases. The “without logging” claim likewise lacks a stdout/stderr assertion.

**Low — Unsupported JSON charset produces a misleading 503**  
`services/disposable-email-validator/server.js`, error middleware

Body-parser can reject unsupported charsets with `charset.unsupported`; the fallback maps this client error to 503. Return a generic 415 for that specific error and add a regression. Preserve generic responses without logging parser errors.

### Infrastructure and activation boundary

The supplied manifests show sensible hardening: non-root execution, read-only filesystem, dropped capabilities, no service-account token, TLS-only listener, same-namespace Logto ingress restriction, and denied validator egress.

However:
- An installed Azure NPM daemonset and successful dry run do **not** establish effective isolation; the denied-source canary remains mandatory.
- No live Service does **not** imply pod-IP isolation once pods run.
- Kubernetes HTTPS probes do not establish client certificate trust; the separate trusted-TLS canary remains necessary.
- The `unreleased` image and inactive consumer patch are staging placeholders, not releasable configuration.

**Deployment: BLOCKED, not approved.** The scoped Vault writer remains unavailable. Secret provisioning, immutable image pinning, alert ownership, trusted TLS, isolation verification, and the documented activation gates must remain prerequisites.

[0m
> plan · gpt-6.1-sol
