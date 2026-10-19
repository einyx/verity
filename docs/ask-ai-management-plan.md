# Ask AI: manage the website, settings, applications and tenants

Status: draft for review. No tools are built yet.

## Goal

The in-product Ask AI assistant (`packages/core/src/routes/ai-chat.ts`) should be able to manage the
website (landing page CMS), settings, applications and tenants, not only answer questions.

## Decisions

1. **Operators can act across tenants through the assistant**, for admins. Every cross-tenant call checks
   the operator role on the server, and its audit entry names the admin and the target tenant.
2. **Users can set "always allow" to skip confirmation.** This needs a per-user permission-grant model
   with a server-side record of each grant.
3. **"Always allow" never covers destructive, billing, MFA, secrets, or cross-tenant actions.** Those keep
   explicit confirmation every time. (Proposed default; not yet confirmed.)

## Out of scope for v1 (proposed default)

All five are out of scope until a later decision:

- Tenant deletion
- Billing and plan changes
- MFA changes (and the read-only MFA carve-out in commit `40e47fbb9` gets re-reviewed under this model)
- API secrets and key rotation
- Role grants

## Principles

- **Authorization comes from the signed-in user, not the model.** Each tool call runs with the user's own
  permissions and is checked server-side, at the same guard the REST route uses. Tools wrap existing
  service and route logic. They never call internal endpoints with a service token.
- **Tool output is untrusted.** Tenant names, app descriptions, and CMS copy can carry injected
  instructions. Tool results never satisfy a confirmation and never grant permissions.
- **Confirmation is structural.** The model proposes a plan. The server stores it with a hash of the exact
  diff and an expiry. The UI shows the diff, with the resolved tenant name and ID, and the user clicks to
  confirm. A model-written "yes" in chat does not count.
- **Every write is audited** with the human, the assistant, the proposed plan, the confirmation, and the
  result. The assistant cannot edit the audit log.

## Action inventory

| Action | Class | Permission | Reversible | Confirmation |
| --- | --- | --- | --- | --- |
| Read tenant, settings, apps (non-security) | read | tenant member | n/a | none |
| Read landing page CMS content | read | CMS scope (`manage:landing:page`) | n/a | none |
| Edit CMS draft (not published) | low-risk write | CMS scope | yes (draft revert) | confirm, or always-allow |
| Publish CMS page | write, public | CMS scope + admin | partly | confirm every time |
| Edit non-security app or tenant setting | low-risk write | tenant admin | yes (previous value) | confirm, or always-allow |
| Cross-tenant read or write | operator | operator role | depends | confirm every time |
| Tenant deletion, billing, MFA, secrets, role grants | destructive or sensitive | n/a | n/a | out of scope for v1 |

The permission column is a proposal. Verify each row against the existing routes before building.

## Confirmation and always-allow rules

- Plans expire after a short window. A stale plan is rejected, and the user has to re-confirm.
- A plan runs once. A double-submit or retry reuses the same plan ID and does not run twice.
- Multi-step plans are all-or-nothing where possible. When that's not possible, the plan states which steps
  can't be undone.
- Always-allow is per user, per action class, per tenant. It is stored server-side, can be revoked from the
  console, and is recorded in the audit log when granted and used.
- Always-allow is never offered for classes outside the low-risk writes row above.

## Acceptance matrix (first slice)

| Class | Confirmation | Audit fields | Rollback | Negative tests |
| --- | --- | --- | --- | --- |
| Read | none | none (standard request log) | n/a | wrong tenant returns 403 |
| Low-risk write | confirm or always-allow | user, assistant, plan hash, result | revert to previous value | wrong tenant, injected text in the target field, expired plan |
| Cross-tenant | confirm every time | admin, target tenant, plan, result | per action | non-operator blocked, injected text cannot switch tenant |
| Publish CMS | confirm every time | user, page, version | unpublish | injected CMS copy cannot publish |

## Rollout

1. Read tools only, behind `isDevFeaturesEnabled` (with a comment naming the Ask AI management feature).
2. Propose / confirm / execute pipeline and audit log, with no other write tools.
3. CMS draft edits (low-risk write).
4. Non-security settings and app edits.
5. Cross-tenant operator actions.
6. Publishing, after review.

If any change alters an API, the OpenAPI document is updated in the same PR, using `Dev feature` tags until release.

## Open questions

- Does the out-of-scope list above match what you want for v1?
- Should an always-allow grant expire, or does it last until revoked?
- Which existing routes back each read and write row? To verify before the rollout starts.
