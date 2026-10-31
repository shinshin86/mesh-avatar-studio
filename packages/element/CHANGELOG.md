# mesh-avatar-element

## 0.4.1

### Patch Changes

- Updated dependencies [acde8e8]
  - mesh-avatar@0.6.0

## 0.4.0

### Minor Changes

- 24f8172: Experimental full-body support; its rig fields and behaviour may change. Add optional cloth layers with body-following garment physics and per-garment tuning through `setClothTuning`. Preserve the clothed base for older players and export `ClothTuning` through the runtime, element and React packages.

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

### Patch Changes

- Updated dependencies [063f836]
- Updated dependencies [24f8172]
- Updated dependencies [1674c25]
  - mesh-avatar@0.5.0

## 0.3.0

### Minor Changes

- 43b82d0: Add the `overlays` attribute and property to show an avatar's optional overlay layers, such as glasses, by name. The choice is kept when the avatar reloads.

### Patch Changes

- Updated dependencies [9d752c1]
  - mesh-avatar@0.4.0

## 0.2.1

### Patch Changes

- 386ab9b: The standalone build (`mesh-avatar-element/standalone`) now carries the runtime fix for avatars with only some drawn eye or mouth variants: missing drawings fall back to the layered eye and the shader mouth instead of hiding the eyes or the mouth.
- Updated dependencies [9e3001b]
  - mesh-avatar@0.3.1

## 0.2.0

### Minor Changes

- fc3e071: Add optional mouth-movement settings for audio loudness and kana previews: granularity, openness and closing speed. Configure them with `lipSync` or partial `setLipSync` updates; omitted and center values preserve the existing motion. Avatar manifests store the settings and optional editor preset, and loaders apply them. The element retains explicit property or method overrides across loads.

### Patch Changes

- Updated dependencies [fc3e071]
  - mesh-avatar@0.3.0

## 0.1.1

### Patch Changes

- 555611a: Coalesce connected element source and fit changes into one load per task.

## 0.1.0

### Minor Changes

- 5cec24b: Add a custom HTML element and standalone browser bundle for embedding mesh avatars.
