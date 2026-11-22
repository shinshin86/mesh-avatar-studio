---
"mesh-avatar": patch
---

Apply `rig.head.weightOutline` to the legs' head counter-correction too, so on avatars with legs a raised hand outside the outline no longer keeps part of the head's motion. A missing or non-positive `rig.head.weightFeather` now falls back to the default 16 px instead of producing `NaN` weights.
