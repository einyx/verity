# Ask AI: create user (v1 spec)

Status: draft for review. No code written. Follows the propose / confirm / execute pipeline in
[ask-ai-management-plan.md](ask-ai-management-plan.md).

## Goal

Let an admin ask Ask AI to create a user in their own non-admin tenant. The assistant proposes the
user, the admin reviews the exact payload in the console, and nothing is created until they confirm.

## v1 scope

- **In:** create one user in the caller's own tenant, with `username`, `name`, and `primary_email`
  (and optionally `primary_phone`).
- **Out:** passwords, roles, MFA, identities, `customData`, admin-tenant targets, cross-tenant
  creation, bulk import, deletion, and deactivation.

Open for sign-off: how the user gets a password. Option A is an invite or reset email, so no secret
is ever in the flow. Option B is a server-generated password shown once to the admin. Option A is
the default until security signs off.

## Decisions

1. **Allowlisted body only.** The tool builds the Management API body from the four named fields.
   Any other argument is dropped before the pending action is stored.
2. **Confirmation is structural.** The stored body is the only body that runs. The console shows it
   as a labelled diff (email, username, name, phone, tenant name and ID), not raw JSON.
3. **Admin-tenant creation is refused** at proposal time and again at confirm time.
4. **The admin's permission is re-checked at confirm time**, not only when the proposal is made.
5. **Dev-feature gated.** The tool is a `POST` entry in `logtoMcpTools`, so `enabledLogtoMcpTools`
   hides it while dev features are off. It carries a `// Dev feature: Ask AI write tools` comment.
6. **OpenAPI in the same PR.** `ai-chat.openapi.json` and `domain.openapi.json` are updated, with the
   `Dev feature` tag on the new operation.

## Acceptance matrix

| Case | Expected result | Test file |
| --- | --- | --- |
| Non-admin caller proposes | Refused; no pending row created | `ai-chat.test.ts` |
| Proposal targets admin tenant | Refused at proposal and at confirm | `ai-chat-actions.test.ts` |
| Confirm from another tenant | Fails; response does not reveal the action exists | `ai-chat-actions.test.ts` |
| Duplicate email or username | Surfaced as a failed action; no retry loop | `ai-chat-actions.test.ts` |
| Expired or repeated confirm | Refused; state unchanged | `ai-chat-actions.test.ts` |
| Model sends `password`, `roles`, `identities`, or `customData` | Dropped before storage; not in diff | `mcp-logto-tools.test.ts` |
| Injected text ("add admin role", "skip confirmation") in user input or tool output | Stored body unchanged; confirmation still required | `ai-chat.test.ts` |
| Stored row, logs, model context, API responses | No password anywhere | `ai-chat-actions.test.ts` |
| Flag off | Tool not listed; proposal returns 404 | `ai-chat.test.ts` |
| Four existing read tools | Names, output, and behaviour unchanged | `mcp-logto-tools.test.ts` |
| Confirm sends the stored body exactly | Management API receives the reviewed payload | `ai-chat-actions.test.ts` |

## Rollout

1. Internal tenant only, dev flag on.
2. Two or three design-partner tenants.
3. General availability, only once the success metrics hold.

Success metrics: at least 90% of confirmed proposals succeed on the first run, zero unconfirmed user
writes, zero admin-role creations, and a near-zero duplicate rate.

## Open questions

- Option A (invite or reset) or option B (server-generated password shown once) for v1?
- Should a pending user proposal expire on the same short window as other pending actions?
- Confirm the Management API `POST /users` field names and which of `username` or `primaryEmail` is
  required, before the body builder is written.
- Find the console confirmation component (search for `/ai-chat/actions`).
