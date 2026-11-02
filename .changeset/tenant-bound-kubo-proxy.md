---
"@logto/core": patch
---

Enforce tenant-bound signed Kubo console delegation, verify admin-only bearer provenance for explicit operator scope, and route MCP stack reads through the authenticated Management API. Preserve read-only guards and fail closed for unavailable signing or backend policy protection.
