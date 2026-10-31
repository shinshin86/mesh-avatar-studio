# mesh-avatar

## 0.6.0

### Minor Changes

- acde8e8: Add optional `rig.view.irisTravel` to set how far the irises move at full gaze. Avatars without it keep the previous 7 px.

## 0.5.0

### Minor Changes

- 063f836: Allow an optional third `setParameters` argument to blend individual parameters with
  underlying motion. Omitted or null per-parameter weights clear previous overrides
  and use the global weight. Existing calls retain their behavior. Studio uses this to fade
  body tracking's weight shift back to idle without fading face tracking.
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

- 1674c25: Experimental: add optional two-bone arms with independent swing and elbow parameters, bounded motion, and subtle idle follow. Avatars without an arms rig retain their existing deformation.

## 0.4.0

### Minor Changes

- 9d752c1: Add optional overlay layers: full-size accessory drawings such as glasses, listed in `built/overlays/overlays.json` and switched by name with `setOverlays`. Only their opaque area is meshed, and hidden overlays are not deformed. Avatars without overlays render as before, and older runtimes ignore the directory. `validateAvatarFiles`, `openAvatar` and project packing read, check and include the overlay files.

## 0.3.1

### Patch Changes

- 9e3001b: Avatars with only some drawn eye or mouth variants no longer lose their eyes or mouth. A
  missing half-closed eye now uses the layered eye, a missing smiling eye uses the closed one,
  and a mouth shape without a drawing uses the shader mouth. Avatars with all variants, or none,
  render exactly as before.

## 0.3.0

### Minor Changes

- fc3e071: Add optional mouth-movement settings for audio loudness and kana previews: granularity, openness and closing speed. Configure them with `lipSync` or partial `setLipSync` updates; omitted and center values preserve the existing motion. Avatar manifests store the settings and optional editor preset, and loaders apply them. The element retains explicit property or method overrides across loads.

## 0.2.1

### Patch Changes

- 144ebc9: Show an animated demo of face tracking at the top of the README.

## 0.2.0

### Minor Changes

- 478a8ff: Switch to drawn expression eyes (`eyes_sad`, `eyes_surprise` sprites) and closed mouths (`mouth_angry`, `mouth_sad`) while the matching expression or emotion tag is active. Blinking still closes the eyes, speaking still shows the open mouth drawings, and avatars without these sprites look the same as before.

## 0.1.1

### Patch Changes

- c30e3e8: Explain in the package README how to get a `.mavatar` file from Mesh Avatar Studio.

## 0.1.0

### Minor Changes

- 133b02a: First public release
