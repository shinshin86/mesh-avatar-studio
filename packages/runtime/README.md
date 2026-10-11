# mesh-avatar

A WebGL runtime for 2D mesh avatars created with [Mesh Avatar Studio](https://github.com/shinshin86/mesh-avatar-studio). Load a `.mavatar` archive or an avatar folder into a canvas, then control its motion, voice level and expressions.

## Install

```sh
npm install mesh-avatar
```

The package is ESM and includes TypeScript declarations. Rendering requires a browser with WebGL. It has no React dependency; the animation loop starts automatically after loading.

## Get a `.mavatar` file

Open your project in Mesh Avatar Studio and choose **Export .mavatar** in the editor header.
The file holds the rig, the built layers, any drawn eye and mouth variants and a manifest,
so it is all the runtime needs. You can also pack a project folder from the command line
with `npm run pack-avatar -- projects/<name>` in the Studio repository.

## Load an avatar

Place an exported `.mavatar` file in your app's public assets and provide a canvas:

```html
<canvas id="avatar" width="720" height="960"></canvas>
```

```js
import { loadMeshAvatar } from 'mesh-avatar';

const canvas = document.querySelector('#avatar');
const avatar = await loadMeshAvatar(canvas, '/avatars/character.mavatar');
```

To load the unpacked folder instead, serve its `rig.json`, `built/` assets and optional `avatar.json` under a folder URL:

```js
import { loadMeshAvatar } from 'mesh-avatar';

const canvas = document.querySelector('#avatar');
const avatar = await loadMeshAvatar(canvas, '/avatars/character/');
```

Use one loading example per canvas. Asset URLs must be reachable by the browser; cross-origin hosting needs the appropriate CORS headers. You can also pass a `URL`, `Blob`, `ArrayBuffer` or `Uint8Array` to `loadMeshAvatar` for an archive.

## Drive the avatar

```js
// Idle motion and blinking are enabled by default.
avatar.setAutoIdle(true);

// While your app plays voice audio, feed its normalized loudness (0–1).
avatar.setSpeaking(true);
avatar.setVoiceLevel(0.6);

// Set an emotion for the spoken line, or a persistent expression overlay.
avatar.setEmotion('happy', { playMotion: false });
avatar.setExpression('smile');

// Apply tracked or posed parameters. Each call replaces the supplied overrides.
avatar.setParameters({ angleX: 10, gazeX: 0.25 }, 1);

// When the line finishes, return to idle and clear overrides.
avatar.setVoiceLevel(0);
avatar.setSpeaking(false);
avatar.setEmotion(null);
avatar.setExpression('neutral');
avatar.setParameters({});

// When removing the canvas or replacing the avatar:
avatar.destroy();
```

Emotion tags are `happy`, `sad`, `angry`, `surprised`, `relaxed` and `neutral` (or `null` to reset). Expressions are `neutral`, `smile`, `shy`, `surprise`, `halfLidded`, `angry`, `sad` and `wink`; `LIVE_EXPRESSIONS` exports that list. `PARAMS` exports the parameter IDs, ranges and defaults. Voice methods animate the avatar; your app handles audio playback.

`loadMeshAvatar` releases archives it opens on `destroy()` or load failure; when passed an existing `AvatarPackage` from `openAvatar`, the caller owns it and must call `release()` after its last user is destroyed.

For custom loading or tooling, the package also exports `createMeshAvatar`, `openAvatar`, `packAvatar`, `unpackAvatar`, `validateAvatarFiles`, `parseManifest`, `parseRig`, `validateRig` and lighting settings. See the [avatar format reference](https://github.com/shinshin86/mesh-avatar-studio/blob/main/docs/format.md) for archive contents, validation and compatibility rules.

## License

The runtime is MIT licensed; see [LICENSE](./LICENSE). The browser bundle includes [fflate](https://github.com/101arrowz/fflate), with its MIT notice retained in the bundle.

Avatar artwork has its own license. Miko images and other sample artwork are **not included** in this npm package, and the runtime license does not grant rights to that artwork.
