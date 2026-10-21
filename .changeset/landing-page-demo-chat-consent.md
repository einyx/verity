---
"@logto/core": patch
---

keep the landing page demo chat from sending a request before the visitor agrees

The demo chat now sends a request only after the visitor answers yes to being contacted, and it asks for any missing detail by name. Replies stay short and ask one question at a time. If a visitor says no, no details are sent. Retrying after a delivery failure no longer files a second demo request.
