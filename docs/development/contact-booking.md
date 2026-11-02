# Optional contact booking

Set the public build variable `VITE_CONTACT_BOOKING_URL` to an owner-approved HTTPS scheduling destination to show the Contact modal's existing Book action. Without a configured valid URL, no booking destination is invented. The previous personal scheduling link is not restored.

This URL is embedded in browser assets: never use bearer credentials, signed private links or customer information. Credential-bearing and non-HTTPS URLs are rejected. Selecting Book opens the configured destination; it does not automatically schedule a meeting or send a message. Per-lead booking configuration is unchanged.
