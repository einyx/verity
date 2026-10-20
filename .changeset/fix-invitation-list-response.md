---
"@logto/console": patch
---

fix the tenant invitation list failing to load

The invitation list and the invite form now read the invitations returned by the cloud service, so pending invitations show and no longer break the invite form.
