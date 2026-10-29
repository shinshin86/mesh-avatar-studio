# mesh-avatar

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
