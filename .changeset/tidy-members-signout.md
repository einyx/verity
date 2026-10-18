---
"@logto/core": patch
"@logto/console": patch
---

fix the tenant member list and sign-out redirect in cloud

The tenant members list now loads instead of returning 404. Signing out of the console now returns to the console's sign-in page, so the sign-out redirect URI is accepted.
