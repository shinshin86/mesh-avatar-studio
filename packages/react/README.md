# mesh-avatar-react

Embed an animated 2D avatar in React with `<MeshAvatar />`. Uses the [mesh-avatar-element](https://github.com/shinshin86/mesh-avatar-studio/tree/main/packages/element) custom element and the [mesh-avatar](https://github.com/shinshin86/mesh-avatar-studio/tree/main/packages/runtime) WebGL runtime. Tested with React 19. The peer dependency accepts React 18 and later.

<p align="center">
  <img src="https://raw.githubusercontent.com/shinshin86/mesh-avatar-studio/main/docs/images/face-tracking.gif" width="400" alt="A Mesh Avatar Studio avatar following a face through a webcam">
</p>

## Getting started

```sh
npm install mesh-avatar-react
```

```tsx
import { MeshAvatar } from 'mesh-avatar-react';

export function Character() {
  return <MeshAvatar expression="smile" label="Character" style={{ width: 320 }} />;
}
```

Without `src`, the component loads Miko from
`https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar`.
The background is transparent. Set the size with CSS: the element defaults to `display: block; aspect-ratio: 1 / 1`.

### Your own avatar

Open your project in [Mesh Avatar Studio](https://github.com/shinshin86/mesh-avatar-studio) and choose **Export .mavatar**. Put the exported file on your site:

```tsx
<MeshAvatar src="/avatars/character.mavatar" style={{ width: 'min(100%, 320px)' }} />
```

An unpacked avatar folder URL also works. Cross-origin assets need CORS headers.

### A file chosen by the user

```tsx
import { useState } from 'react';
import { MeshAvatar } from 'mesh-avatar-react';

export function FilePreview() {
  const [file, setFile] = useState<File>();
  return <>
    <input type="file" accept=".mavatar" onChange={event => setFile(event.target.files?.[0])} />
    <MeshAvatar source={file} onError={error => console.error(error)} style={{ width: 320 }} />
    <button onClick={() => setFile(undefined)}>Restore Miko</button>
  </>;
}
```

`source` takes precedence over `src`. Removing `source` restores `src`, or Miko if `src` is omitted. Keep the same File, Blob or buffer object between renders to avoid loading it again.

## Props

| Prop | Type | Default or behavior |
| --- | --- | --- |
| `src` | `string` | Miko archive URL when omitted |
| `source` | `AvatarSource` | File, Blob, ArrayBuffer, Uint8Array, URL or URL string; takes precedence over `src` |
| `expression` | `LiveExpression` | `neutral`; also `smile`, `shy`, `surprise`, `halfLidded`, `angry`, `sad`, `wink` |
| `emotion` | `Emotion` | Unset; `happy`, `sad`, `angry`, `surprised`, `relaxed`, `neutral` |
| `fit` | `Fit` | `contain` or `cover`; defaults to `contain` |
| `paused` | `boolean` | Pause animation; defaults to `false` |
| `noIdle` | `boolean` | Disable automatic idle motion; defaults to `false` |
| `label` | `string` | Accessible canvas label; defaults to `Avatar` |
| `overlays` | `string[]` | Overlay layers to show, such as `['glasses']`; none by default. Names come from the avatar's `built/overlays/overlays.json` |
| `onLoad` | `(avatar: MeshAvatarInstance) => void` | Avatar loaded and ready |
| `onError` | `(error: unknown) => void` | Loading failed; the element is empty until a successful load |
| `onMotion` | `(id: string \| null) => void` | Motion changed |
| `ref` | `Ref<MeshAvatarElement>` | Access the element and runtime methods |
| HTML attributes | `id`, `className`, `style`, `title`, `hidden`, `aria-*`, `data-*`, etc. | Forwarded to the element |

Removing a prop removes its attribute. Changes to `src` or `fit` reload the avatar; changes in the same React commit are combined into one load. `onLoad` and `onError` receive avatar data and errors, rather than React DOM events.

Exported types: `MeshAvatarProps`, `MeshAvatarElement`, `MeshAvatarInstance`, `AvatarSource`, `LiveExpression`, `Emotion`, `Fit`. The package also exports `DEFAULT_SRC` and `EMOTIONS`.

## Ref methods

The ref points to the custom element. `ref.current.avatar` exposes all [runtime methods](https://github.com/shinshin86/mesh-avatar-studio/tree/main/packages/runtime#drive-the-avatar). `ready` resolves with the current avatar; handle rejections if loading can fail.

```tsx
import { useRef } from 'react';
import { MeshAvatar, type MeshAvatarElement } from 'mesh-avatar-react';

export function SpeakingCharacter() {
  const ref = useRef<MeshAvatarElement>(null);
  return <>
    <MeshAvatar ref={ref} style={{ width: 320 }} />
    <button onClick={() => ref.current?.avatar?.setExpression('smile')}>Smile</button>
    <button onClick={() => ref.current?.setLipSync({ granularity: 1, openness: 0.5, closeSpeed: 1 })}>Snappy mouth</button>
    <button onClick={() => void ref.current?.speak('こんにちは').catch(console.error)}>Animate speech</button>
  </>;
}
```

`speak(text, { speed, loop })` animates Japanese mouth shapes without generating audio. `play(id)` plays a motion and waits for loading. `load(source)` loads an imperative source, returning the loading promise.

Use `ref.current?.setLipSync(...)` for mouth-movement settings; there is no separate prop.
`granularity` controls syllable separation, `openness` controls mouth size and `closeSpeed`
controls closing speed (each 0–1, default 0.5). Updates retain omitted values and survive
avatar reloads. Settings saved in Studio are applied automatically. See the
[runtime style table](https://github.com/shinshin86/mesh-avatar-studio/tree/main/packages/runtime#mouth-movement).

### Audio file or TTS audio

Use `setVoiceLevel` through the ref for per-frame mouth movement. Replace `/voice.mp3` with an audio file or a TTS audio URL. Cross-origin audio needs CORS headers. This example starts playback from a button and cleans up on unmount.

```tsx
import { useEffect, useRef } from 'react';
import { MeshAvatar, type MeshAvatarElement } from 'mesh-avatar-react';

export function VoiceCharacter() {
  const ref = useRef<MeshAvatarElement>(null);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  async function playVoice() {
    stop.current();
    const el = ref.current;
    if (!el) return;
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.src = '/voice.mp3';
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaElementSource(audio).connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Float32Array(analyser.fftSize);
    let frameId = 0;
    let stopped = false;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frameId);
      audio.pause();
      el.avatar?.setSpeaking(false);
      el.setVoiceLevel(0);
      void ctx.close();
    };
    stop.current = cleanup;
    audio.onended = cleanup;
    audio.onerror = cleanup;
    try {
      await ctx.resume();
      await el.ready;
      if (stopped) return;
      await audio.play();
      if (stopped) { audio.pause(); return; }
      el.avatar?.setSpeaking(true);
      const frame = () => {
        if (stopped) return;
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
        el.setVoiceLevel(Math.min(1, rms * 5));
        frameId = requestAnimationFrame(frame);
      };
      frame();
    } catch (error) {
      cleanup();
      console.error(error);
    }
  }

  return <>
    <MeshAvatar ref={ref} style={{ width: 320 }} />
    <button onClick={() => void playVoice()}>Play voice</button>
  </>;
}
```

## Next.js

The package includes a `'use client'` directive and can be imported directly in an App Router page:

```tsx
import { MeshAvatar } from 'mesh-avatar-react';

export default function Page() {
  return <MeshAvatar src="/avatars/character.mavatar" style={{ width: 320 }} />;
}
```

Use your own client component when passing callbacks or accessing a ref. Server rendering outputs the element and HTML attributes; avatar attributes and loading are applied in the browser. Size is controlled by CSS.

## Using the Miko sample

Without `src`, Miko loads from Mesh Avatar Studio's GitHub Pages site. To host it yourself instead, save
[the Miko archive](https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar) as part of your site and point `src` at your copy.

Miko © Yuki Shindo (AITuber OnAir). Follow the [Miko character guidelines](https://miko.aituberonair.com/#terms).
Redistribution as part of an application or website is allowed; standalone distribution, asset collections and distribution primarily intended to provide the assets are not.
Do not imply official affiliation or endorsement by Miko or AITuber OnAir, or claim ownership of the character or exclusive usage rights. See also the [sample asset terms](https://github.com/shinshin86/mesh-avatar-studio/blob/main/samples/miko-qipao/MIKO_ASSET_TERMS.md).

## Notes

- Requires WebGL2 in a browser.
- Avoid placing many avatars on one page: browsers limit simultaneous WebGL contexts.
- Animation pauses offscreen, while the tab is hidden, or when `paused` is true.
- With `prefers-reduced-motion: reduce`, hair sway is reduced.

## License

MIT. Miko's artwork is subject to the character guidelines above.
