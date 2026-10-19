---
"@logto/console": patch
---

fix tenant api requests from the console being rejected

Requests to the tenant authentication endpoints now use the cloud API token, so member management and tenant creation no longer fail with an authorization error.
