# mesh-avatar

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
