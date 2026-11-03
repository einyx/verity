---
"@logto/console": patch
---

fix the Prysm wordmark in the console topbar

The wordmark is rendered as an SVG component instead of being handed to an image element, so it appears again in the console topbar and the onboarding topbar.
