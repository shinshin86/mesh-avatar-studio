---
"mesh-avatar": minor
"mesh-avatar-element": minor
"mesh-avatar-react": minor
---

Experimental full-body support; its rig fields and behaviour may change. Add optional cloth layers with body-following garment physics and per-garment tuning through `setClothTuning`. Preserve the clothed base for older players and export `ClothTuning` through the runtime, element and React packages.

Add optional planted-leg rig data and the `weightShift` parameter for five-second idle weight transfer, with fixed feet and soft knee flexion. Avatars without `legs` retain their existing deformation.

Replace the unreleased cloth row-chain simulation with acceleration-driven column pendulums, coherent wind, hem arc motion and a small bend controlled by `follow`. Keep cloth-free avatars unchanged.

Derive cloth pendulum frequencies from source scale, column length and gravity, with optional millimetres-per-pixel `cloth.scale`. Interpret `swing` as a physical frequency multiplier and include vertical pivot acceleration in apparent gravity.

Add optional planted-rig spine stabilization and transfer dip, with delayed chest/head response and default five-second held weight transfers for rigs with `legs` (0.9-second smooth transition and 1.6-second hold per half-cycle, targeting `±0.7`). Replace cloth columns with physically coupled two-link pendulums and add optional `responseGain` for clearly labelled render-only cloth exaggeration. Preserve cloth-free, leg-free deformation and motion.

Add optional source-space cloth `seams` and `tiers` with coupled N-link pendulums,
length-proportional masses and modal damping. Add render-only relative bending
exaggeration with `tierGain` and higher-mode damping control with
`highModeDamping`, both defaulting to 1. Without seams or tiers, retain the existing
two-link solver. Studio can edit seam and tier lines without rebuilding layers.

Add optional `legs.twist` in degrees for pelvis yaw during weight transfer, partial
shoulder counterturn and a frontal head with planted feet. Omitted or zero twist
preserves the existing output; Studio exposes the setting in English, Japanese
and Chinese.
