# mesh-avatar-element

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
