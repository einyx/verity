# Slack security notification context

Detailed context is an explicit opt-in for restricted security channels. Standard
Slack summaries and generic webhook payloads keep their existing behavior.

When development features are enabled, set the following environment variable on
the Logto service using the exact IDs of approved security webhooks:

```text
SLACK_SECURITY_NOTIFICATION_HOOK_IDS=approved-hook-id,another-approved-hook-id
```

IDs are matched exactly after trimming whitespace. Empty values, prefixes and
wildcards do not opt in a webhook. Hook IDs are globally unique database keys.
Do not enable development features globally in another environment merely to
turn on notifications; follow that environment's release policy instead.

## Included context

- Existing readable event/action and UTC/localized event time.
- Exact event name and webhook ID for delivery/configuration correlation. A
  webhook ID is not a unique audit-event ID.
- For interaction events, the user ID and primary email when supplied. The
  email is personal data: use only an appropriately restricted channel.
- Application ID alongside the existing application display name when supplied.
- Browser and OS family parsed from the user-agent; never the raw user-agent.
  These are client-reported hints, not proof of a trusted or verified device.
- Explicitly marked test notifications, using the test route's server-side flag.
- Existing affected-entity details and provenanced subject IDs for mutation
  events. Affected entities are not presented as the acting administrator. Actor
  information not present in the event is explicitly marked as not provided.

## Never included in the Slack security summary

- IP addresses or geolocation, including IP literals embedded in display fields.
- Raw session IDs, session/access/refresh tokens, passwords or request headers.
- Arbitrary custom data, profiles, identities, role permissions or payload dumps.
- An inferred sign-in method, MFA success, risk score or acting administrator.

Values are bounded and control characters removed. Display details use Slack
plain-text blocks; fallback mentions are escaped and link/media previews are
disabled. IP-shaped display strings are conservatively masked, which may also
omit address-like numeric identifiers. Existing Slack URL/secret redaction, request signing, SSRF protection,
delivery retries and non-Slack payload contracts remain intact.

## Verification and rollout

Run the hook formatter, dispatch and request tests before rollout. Use synthetic
offline fixtures to preview a message; do not send an all-selected-events test
blast to the channel. Preserve the existing webhook URL, signing key, enabled
state and selected events. Deploy only to the approved environment, and verify
the opt-in IDs and the next intended notification without exposing credentials.
