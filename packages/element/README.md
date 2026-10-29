# mesh-avatar-element

Embed an animated 2D avatar with a `<mesh-avatar>` HTML element. Uses the [mesh-avatar](https://github.com/shinshin86/mesh-avatar-studio/tree/main/packages/runtime) WebGL runtime, with no framework required.

For React and Next.js, use [mesh-avatar-react](https://github.com/shinshin86/mesh-avatar-studio/tree/main/packages/react).

<p align="center">
  <img src="https://raw.githubusercontent.com/shinshin86/mesh-avatar-studio/main/docs/images/face-tracking.gif" width="400" alt="A Mesh Avatar Studio avatar following a face through a webcam">
</p>

## Getting started

### CDN

Add these two lines to your page to show the Miko sample:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/mesh-avatar-element@0/dist/standalone.js"></script>
<mesh-avatar></mesh-avatar>
```

Without `src`, the element loads Miko from
`https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar`.

### npm

```sh
npm install mesh-avatar-element
```

Import once in your app's JavaScript:

```js
import 'mesh-avatar-element';
```

Then add `<mesh-avatar></mesh-avatar>` to your HTML.

### Your own avatar

Open your project in [Mesh Avatar Studio](https://github.com/shinshin86/mesh-avatar-studio) and choose **Export .mavatar**. Put the exported file on your site and set `src`:

```html
<mesh-avatar src="/avatars/character.mavatar" expression="smile"></mesh-avatar>
```

An unpacked avatar folder URL also works. Cross-origin assets need CORS headers.

### Size

The element defaults to `display: block; aspect-ratio: 1 / 1`. Set its width in your page's CSS; you can also override its height or aspect ratio. The background is transparent.

```html
<style>
  mesh-avatar { width: min(100%, 320px); }
</style>
<mesh-avatar></mesh-avatar>
```

## Attributes

| Attribute | Values | Default |
| --- | --- | --- |
| `src` | A `.mavatar` URL or avatar folder URL | [Miko on GitHub Pages](https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar) |
| `fit` | `contain`, `cover` | `contain` |
| `expression` | `neutral`, `smile`, `shy`, `surprise`, `halfLidded`, `angry`, `sad`, `wink` | `neutral` |
| `emotion` | `happy`, `sad`, `angry`, `surprised`, `relaxed`, `neutral` | Unset |
| `paused` | Boolean attribute; presence pauses animation | Absent |
| `no-idle` | Boolean attribute; presence disables automatic idle motion | Absent |
| `label` | Accessible canvas label | `Avatar` |
| `overlays` | Space-separated overlay layer names to show, such as `glasses`; names come from the avatar's `built/overlays/overlays.json`, and unknown names are ignored | None shown |

Attributes can be changed after loading. Connection and `src` / `fit` changes in the same task are combined into one load in a microtask; `load(source)` starts immediately. Changing `src` or `fit` destroys the current avatar and loads a new one. After `load(source)`, changing `fit` reloads that source; changing `src` switches back to the attribute URL. A failed load leaves the element empty; listen for `error` to show a fallback. Unknown expression, emotion or fit values warn once per attribute/value pair rather than throwing.

## Properties, methods and events

Wait for the custom element to be registered before accessing it from a separate script:

```js
await customElements.whenDefined('mesh-avatar');
const el = document.querySelector('mesh-avatar');
await el.ready;
el.avatar.setExpression('smile');
```

| Property or method | Description |
| --- | --- |
| `avatar` | Loaded runtime avatar, or `null`. All [runtime methods](https://github.com/shinshin86/mesh-avatar-studio/tree/main/packages/runtime#drive-the-avatar) are available through `el.avatar`. |
| `load(source)` | Loads a File, Blob, ArrayBuffer, Uint8Array, URL or URL string without changing `src`. Returns the loading promise and emits `load` or `error`. The `AvatarSource` type is re-exported from `mesh-avatar`. |
| `ready` | Promise resolving with the avatar for the current source, rejecting on loading failure. A new load after completion creates a new promise; overlapping pending loads resolve with the latest avatar. |
| `src`, `fit`, `expression`, `emotion`, `paused` | Properties reflecting their corresponding attributes. Use attributes for `no-idle` and `label`. |
| `overlays` | Array of overlay layer names to show, reflecting the `overlays` attribute; `[]` hides them all. The choice is kept when the avatar reloads. |
| `lipSync` | Get a copy of explicit mouth-movement overrides, or assign a partial `LipSyncSettings` object. Overrides survive avatar reloads. |
| `setLipSync(settings)` | Partially updates mouth movement: `granularity`, `openness`, `closeSpeed` (0–1). Omitted fields keep their values. |
| `setVoiceLevel(value)` | Mouth opening from loudness, 0–1. Retains the value until loading finishes. |
| `speak(text, options?)` | Calls `speakKana` after loading. Japanese text animates the mouth without generating audio. Options: `speed`, `loop`. |
| `play(id)` | Plays a runtime motion after loading. Available IDs are in `el.avatar.motions`. |

`speak` and `play` return promises; handle rejected promises if loading can fail.

| Event | `event.detail` | When |
| --- | --- | --- |
| `load` | `{ avatar }` | Avatar loaded and ready |
| `error` | `{ error }` | Loading failed |
| `motion` | `{ id }` (string or `null`) | The runtime reports a motion change |

Attach listeners directly to the element with `el.addEventListener('load', event => { /* … */ })`.
Moving the element between parents in the same turn preserves the avatar. Removing it destroys the avatar; reconnecting it reloads the last source, including a File passed to `load()`.

To display a `.mavatar` chosen with a file input, pass the File directly rather than a `blob:` URL:

```html
<input id="avatar-file" type="file" accept=".mavatar">
<mesh-avatar></mesh-avatar>
<script type="module">
await customElements.whenDefined('mesh-avatar');
const el = document.querySelector('mesh-avatar');
document.querySelector('#avatar-file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await el.load(file);
  } catch (error) {
    console.error('Could not load avatar:', error);
  }
};
</script>
```

## Examples

- [Basic embed](https://github.com/shinshin86/mesh-avatar-studio/blob/main/packages/element/examples/basic.html): two HTML lines and a CSS width.
- [Playground](https://github.com/shinshin86/mesh-avatar-studio/blob/main/packages/element/examples/playground.html): expressions, text and audio lip sync, microphone input and your own avatar files.
- [Interactive demo](https://shinshin86.github.io/mesh-avatar-studio/embed/) ([日本語](https://shinshin86.github.io/mesh-avatar-studio/ja/embed/)): try the controls in your browser.

Download either HTML example and open it directly, or serve it on your site. Both load the element and Miko over the internet. Microphone access depends on browser permissions and secure-context support; use HTTPS or localhost if it is unavailable when opening a file directly. Examples are in the repository and are not included in the npm package.

## Lip sync

Each example below assumes the CDN script and a `<mesh-avatar>` element are on your page. Run JavaScript as a module.

### Mouth movement

Use `lipSync` or `setLipSync` to adjust syllable separation, mouth size and closing speed.
Each setting accepts 0–1; 0.5 keeps the original behavior. Settings saved in Studio apply
automatically when the avatar loads. Explicit overrides work before loading and survive
source or fit changes. `LipSyncSettings` is exported as a TypeScript type.

```js
await customElements.whenDefined('mesh-avatar');
const el = document.querySelector('mesh-avatar');
el.lipSync = { granularity: 0, closeSpeed: 0 };
el.setLipSync({ openness: 0.75 }); // Retains the other settings.
```

See the [runtime style table](https://github.com/shinshin86/mesh-avatar-studio/tree/main/packages/runtime#mouth-movement)
for the five Studio styles. These settings apply to text and audio lip sync below.

### Audio file or TTS audio

Replace `/voice.mp3` with an audio file or a URL returned by your TTS service. Cross-origin audio needs CORS headers. Click the button to start playback.

```html
<button id="play-voice">Play voice</button>
<script type="module">
await customElements.whenDefined('mesh-avatar');
const el = document.querySelector('mesh-avatar');
await el.ready;
const audio = new Audio();
audio.crossOrigin = 'anonymous';
audio.src = '/voice.mp3';
const ctx = new AudioContext();
const analyser = ctx.createAnalyser();
ctx.createMediaElementSource(audio).connect(analyser);
analyser.connect(ctx.destination);
const data = new Float32Array(analyser.fftSize);
function frame() {
  if (audio.paused || audio.ended) {
    el.avatar.setSpeaking(false);
    el.setVoiceLevel(0);
    return;
  }
  analyser.getFloatTimeDomainData(data);
  el.setVoiceLevel(Math.min(1, Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) * 5));
  requestAnimationFrame(frame);
}
document.querySelector('#play-voice').onclick = async () => {
  await ctx.resume();
  await audio.play();
  el.avatar.setSpeaking(true);
  frame();
};
</script>
```

### Microphone

Start microphone capture from a user action. Microphone access requires HTTPS or localhost and the user's permission. The microphone is not connected to the speakers.

```html
<button id="mic">Start microphone</button>
<script type="module">
await customElements.whenDefined('mesh-avatar');
const el = document.querySelector('mesh-avatar');
await el.ready;
let stop;
document.querySelector('#mic').onclick = async event => {
  if (stop) {
    stop();
    stop = null;
    event.target.textContent = 'Start microphone';
    return;
  }
  const ctx = new AudioContext();
  await ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const analyser = ctx.createAnalyser();
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let frameId;
  el.avatar.setSpeaking(true);
  const frame = () => {
    analyser.getFloatTimeDomainData(data);
    el.setVoiceLevel(Math.min(1, Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) * 5));
    frameId = requestAnimationFrame(frame);
  };
  stop = () => {
    cancelAnimationFrame(frameId);
    stream.getTracks().forEach(t => t.stop());
    void ctx.close();
    el.avatar.setSpeaking(false);
    el.setVoiceLevel(0);
  };
  frame();
  event.target.textContent = 'Stop microphone';
};
</script>
```

### Text only

This makes mouth shapes from Japanese text; it does not play or synthesize a voice.

```html
<button id="say">Animate speech</button>
<script type="module">
await customElements.whenDefined('mesh-avatar');
const el = document.querySelector('mesh-avatar');
await el.ready;
document.querySelector('#say').onclick = () => el.speak('こんにちは');
</script>
```

## Using the Miko sample

Without `src`, Miko loads from Mesh Avatar Studio's GitHub Pages site. To host it yourself instead, save
[the Miko archive](https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar) as part of your site and point `src` at your copy.

Miko © Yuki Shindo (AITuber OnAir). Follow the [Miko character guidelines](https://miko.aituberonair.com/#terms).
Redistribution as part of an application or website is allowed; standalone distribution, asset collections and distribution primarily intended to provide the assets are not.
Do not imply official affiliation or endorsement by Miko or AITuber OnAir, or claim ownership of the character or exclusive usage rights. See also the [sample asset terms](https://github.com/shinshin86/mesh-avatar-studio/blob/main/samples/miko-qipao/MIKO_ASSET_TERMS.md).

## Notes

- Requires WebGL2 in a browser.
- Avoid placing many avatars on one page: browsers limit simultaneous WebGL contexts.
- Animation pauses offscreen, while the tab is hidden, or when `paused` is present.
- With `prefers-reduced-motion: reduce`, hair sway is reduced.
- The npm entry point can be imported during server-side rendering, but rendering requires the browser.

## License

MIT. Miko's artwork is subject to the character guidelines above.
