---
"@logto/core": minor
"@logto/console": minor
---

Release the Cloud/admin landing-page editor, Ask AI landing-page editing and confirmed draft saving, `get_sign_in_experience`, graph-based Ask AI execution, and ML-DSA-65 signing independently of `DEV_FEATURES_ENABLED`.

Existing permissions, Cloud/admin restrictions, write confirmation, AI configuration checks, and signing-key lifecycle protections remain unchanged. ML-DSA-65 requires Node.js 24.7+ and compatible JWT consumers, remains an explicit per-tenant selection, and does not change existing RSA/EC tenants. Deploy with a private cloud verifier that accepts ML-DSA-65 before enabling it for Cloud tenants. No keys are rotated automatically.

When rolling back after ML-DSA activation, older gated releases must keep development features enabled to retain active and grace-period ML-DSA keys, or use a compatibility-aware key migration before downgrade.
