---
"@logto/core": patch
---

retry the landing page chat once when the assistant model fails

The demo chat no longer shows "We couldn't reach the assistant" after a single temporary model failure. The visitor's message is retried once before the error is shown.
