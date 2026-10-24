# mesh-avatar-element

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
