# Co-located Cloud client transport

Set `CLOUD_INTERNAL_TRANSPORT=true` only when the instance serves its own Cloud
API on the same origin as its admin endpoint. This sends Cloud client token and
API requests to the configured core loopback listener instead of through the
public edge. Canonical Host and forwarded host/protocol select the normal admin
tenant. JWT issuers, audiences, credentials, scopes and quota checks are unchanged.

The flag is off by default. With it enabled, non-Cloud deployments, different
Cloud/admin origins and non-loopback listener hosts fail closed. Listener errors
do not fall back to public routing. Token endpoint redirects are not followed.
Keep the existing trusted-proxy setting required by co-located tenant transport.

This avoids browser-only Cloudflare challenges on machine requests without
disabling Bot Fight Mode or weakening zone-wide security. It does not affect
browser requests, untrusted customizer sandbox selection or external Cloud APIs.

Rollback: restore the previous image/environment through the deployment's
GitOps configuration. Turning the flag off restores public Cloud client routing;
that path may still encounter the original edge challenge.
