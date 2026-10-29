---
"mesh-avatar": minor
"mesh-avatar-element": minor
"mesh-avatar-react": minor
---

Add optional cloth layers with body-following garment physics and per-garment tuning through `setClothTuning`. Preserve the clothed base for older players and export `ClothTuning` through the runtime, element and React packages.

Add optional planted-leg rig data and the `weightShift` parameter for five-second idle weight transfer, with fixed feet and soft knee flexion. Avatars without `legs` retain their existing deformation.

Replace the unreleased cloth row-chain simulation with acceleration-driven column pendulums, coherent wind, hem arc motion and a small bend controlled by `follow`. Keep cloth-free avatars unchanged.

Derive cloth pendulum frequencies from source scale, column length and gravity, with optional millimetres-per-pixel `cloth.scale`. Interpret `swing` as a physical frequency multiplier and include vertical pivot acceleration in apparent gravity.

Add optional planted-rig spine stabilization and transfer dip, with delayed chest/head response and default five-second held weight transfers for rigs with `legs` (0.9-second smooth transition and 1.6-second hold per half-cycle, targeting `±0.7`). Replace cloth columns with physically coupled two-link pendulums and add optional `responseGain` for clearly labelled render-only cloth exaggeration. Preserve cloth-free, leg-free deformation and motion.
