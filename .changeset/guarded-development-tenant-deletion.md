---
'@logto/core': patch
---

support authorized deletion of development tenants while protecting system tenants

Deletion removes the target's identity data, console membership and dedicated database role atomically, with an actor/target audit record. Production tenants remain protected pending billing clearance. Cached tenant instances cannot continue serving after deletion, including when acquisition falls back to cached signing state.
