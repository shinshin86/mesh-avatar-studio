---
"mesh-avatar": minor
---

Allow an optional third `setParameters` argument to blend individual parameters with
underlying motion. Omitted or null per-parameter weights clear previous overrides
and use the global weight. Existing calls retain their behavior. Studio uses this to fade
body tracking's weight shift back to idle without fading face tracking.
