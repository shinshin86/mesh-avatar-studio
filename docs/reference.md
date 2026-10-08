# Reference

Details behind the workflow in the [README](../README.md).

## Projects

Open the local URL printed by Vite. Choose **Open project** and select a project from the local
list, or use **Browse for a project folder…** to select its folder. A project contains
`rig.json`, `source.png` and `built/`. **Load rig.json only…** replaces the rig without loading images.
The header shows the project name with buttons to copy its full path and open its folder.
**Save rig** and Ctrl/Cmd+S save a listed project directly to `rig.json`, keeping the previous
file as `rig.json.bak`. The sample is read-only, and browser-picked folders use a JSON download.
Local project access is available only through the development server on 127.0.0.1; a static
build keeps the folder picker and download workflow. Images stay on this machine.
**Recent** keeps up to ten opened projects in this browser and can reopen the last project
on start. Remove individual entries, clear the history, or disable automatic reopening in
the project menu. Supported browsers retain a directory handle for picked folders and may
ask for permission again; other browsers show **Browse again**. Image data is never stored
in this history.

```text
project/
  rig.json
  source.png
  built/
    layers.json
    base.png
    hairmask.png
    eye0_ball.png
    ...other cut-out layers named in layers.json
    sprites/                 # optional drawn eye/mouth variants
      sprites.json
      ...sprite images
```

## Build a project by hand

The layer builder requires Python 3.10+ and [uv](https://docs.astral.sh/uv/).
It runs locally with NumPy, Pillow and OpenCV; these are build tools, not browser dependencies.
The other Python tools declare dependencies inline for bare `uv run`. The validator and
pose renderer use Node.js 22.17+; install Node dependencies with `npm ci` and Chromium with
`npx playwright install chromium` if needed. [Rig field descriptions](rig-fields.md)
explain coordinates and placement.

1. Create a project folder and put your illustration in `source.png`. A PNG with a transparent
   background works. Use a copy of your artwork when experimenting.
2. Prepare `rig.draft.json`. Use `samples/miko-qipao/rig.json` as a schema example, set `image.width`
   and `image.height` to your image dimensions, and place the geometry in source-image pixels.
   Trace each eye's `opening` inside the lashes and its enclosing `roi` around the lash and lid
   strokes. Place hair strand `nodes` from root to tip. Remove `hand`, `buns` and `accessories`
   if absent; keep the required head, body, face, mouth, cheeks, mesh and view settings.
   The eye fields `x0`, `x1`, `top` and `bot` can be omitted from the draft.
3. From the repository root, build the layers:

   ```sh
   uv run --with numpy --with pillow --with opencv-python-headless tools/build-layers.py /path/to/project --rig rig.draft.json
   ```

   This writes `rig.json` with 24 sampled points for each eye's top and bottom curves, plus
   `built/base.png`, `built/hairmask.png`, the four `eye{i}_ball/lash/low/crease.png` layers per
   eye, and `built/layers.json`. Hand and accessory layers are generated only when present
   in the rig. The input draft remains unchanged. Existing generated files are replaced;
   optional drawn sprites are preserved. Without `--rig`, the input is `rig.json`.
4. In the editor, choose **Open project** and select it from the list, or browse for the whole project
   folder, including `source.png`, `rig.json` and `built/`. Use **Pose test** to check blinking
   and face angles, and **Sweep angles** to check the full motion range.

The builder estimates eyelid skin and line colours near each eye's ROI, and hair colours near
the strand lines and buns. It follows connected colour regions within the head, buns and
strand areas, using nearby skin and body colours to exclude non-hair pixels. Bright hair
highlights or hair with several unrelated colours can leave gaps in the inferred mask.
It does not trace eyes or invent hidden artwork automatically. Incorrect
outlines can leave eye pixels behind during a blink or include skin in a moving layer. Inspect
the result and adjust the rig in the editor. For a writable project opened from the local
list, use **Save and rebuild layers** in the changed-outlines banner. It runs the local
builder and reloads the preview, keeping selection, zoom and undo history. A failed build
keeps the previous layers and offers a log. Browser-picked folders still require saving
the JSON, running the command without `--rig`, and reopening the folder. Keep the original draft separately
if you want to retain it. Drawn closed-eye and mouth variants are optional.

Accessory colour masks currently use the rig's red-dominance thresholds (`color.redness` and
`color.minRed`) inside each `box`. Hair and skin estimation assumes reasonably opaque pixels
around the traced regions; fully translucent artwork or unrelated colours inside an eye ROI
may need manual retouching. Inpainting approximates the artwork hidden behind hands and eyes.

## Editing

- Drag a handle or select an item to edit its numeric fields.
- Double-click a polygon/polyline edge to insert a vertex; Alt-click a vertex to remove it.
- Pinch to zoom at the cursor; two-finger scrolling pans. A mouse wheel zooms by default;
  **Mouse wheel** can switch it to panning. Ctrl/Cmd-scroll always zooms.
- Drag empty space, Space-drag or middle-drag to pan. Use **− / +** to zoom, the percentage
  to return to 100% (one image pixel per screen pixel), **Fit** for the whole image, or
  **Fit selected part** for the current part. Double-clicking a part in the list also fits it.
  Zoom ranges from 10% to 1600%, while dots keep the same screen size.
- Ctrl/Cmd+plus, minus, 0 and 1 zoom in, zoom out, fit and reset to 100%. These shortcuts
  leave browser behavior alone when an input is focused.
- **Undo** / **Redo** restore edits. Keyboard shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+S.
- **Save rig** saves a listed project, or downloads the JSON for a browser-picked folder.
  Dropping a JSON file also loads it.
- Pause **Idle motion** for a stable pose comparison, or use **Sweep angles** to sweep angles.
- Switch between the **Pose test** and **Lip sync** tabs under the preview. **Lip sync**
  holds あ・い・う・え・お・ん, or plays kana text at 4–12 morae per second.
  **Release** / **Stop** return control to the pose sliders. Drawn mouth images are used when
  available; otherwise the mesh mouth animates. This check does not play audio.

**Drawn variants** shows eye and mouth image counts. Check the drawings you want and
copy the prepared message for **Codex** or **Claude Code**. Codex's message requests its
built-in image generation, local import and pose review, and the card states that images
will be sent to Codex image generation. Claude Code's message asks it to prepare masks
and prompts and explain where to save the drawings, then stop. The recipient is remembered. Changes in the local project's `variants/` and `built/sprites/` directories
reload in place, keeping unsaved outlines, selection, zoom and undo history. The sample's
request asks the agent to work on a copy under `projects/`, leaving the original intact.

**If you prepare images yourself** is collapsed by default. Open it to export local masks
and prompts with `variant-requests.py`, or to drop or choose full-size PNGs with the listed
filenames. The editor validates dimensions and pixels outside the mask before building
sprites; rejected imports keep the previous drawings and sprites. Manual export and import
need a writable project from the development server. The app keeps images local; the
Codex card discloses the image-generation upload before you copy its request; other
external services are excluded from that request.

## Lighting

**Lighting** is optional and off by default. Open the collapsed **Lighting** section below the
**Pose test** and **Lip sync** tabs, or near the bottom of the Live page, and choose **Enable lighting**.
While the section is open, a light handle appears over the preview; drag it, or focus it and
use the arrow keys (Shift moves further). The section title shows **ON** while lighting is enabled.

The shape used for shading is inferred from the single image: each layer's silhouette is
rounded, the head is treated as an ellipsoid, and dark painted strokes add shallow relief.
It is computed once per layer when lighting is first enabled. Painted shadows in the artwork
are kept; the light deepens colours on the far side and keeps the painted colour on the lit side.

| Control | Effect |
|---|---|
| Light height | Low values light from the side; high values light from the front |
| Light spread | How far the light reaches before it fades |
| Intensity / Ambient light | Direct light and the even base light |
| Light color / Ambient color | Colours of the direct and ambient light |
| Strength | Blend between the original artwork and the lit result |
| Shading smoothness | Width of the transition between lit and shaded areas |
| Gloss / Rim light | Small highlights, and light along edges facing the light |
| Stroke relief | Relief taken from painted strokes such as hair lines |
| Shading | **Soft** or **Cel** (stepped, anime style) |
| Drop shadow | A soft silhouette shadow behind the avatar, opposite the light |

**Reset lighting** restores the defaults. Settings are presentation only: they are not saved
in `rig.json`, but each project remembers them in this browser. With lighting off, the avatar
renders exactly as without the feature.

## Live and streaming

Two pages served by the development server (`npm run dev`):

- **Live page** (`/live.html?project=<name>`, or **Live** in the editor header): camera and
  microphone controls, face tracking, calibration and the stream URL.
- **Stream view** (`/stream.html`): only the avatar, for OBS or other capture software.

### Stream view URL

| Parameter | Values | Default |
|---|---|---|
| `project` | A project name from the local list, or `sample-miko-qipao` | the sample |
| `bg` | `transparent`, `green`, `blue` or a hex colour such as `#336699` | `transparent` |
| `fit` | `contain` (whole avatar) or `cover` (fill the frame) | `contain` |
| `idle` | `1` (idle motion, blinking, breathing, hair sway) or `0` | `1` |
| `light` | `1` enables [lighting](#lighting); omit it for no lighting | off |
| `lx`, `ly` | Light position across and down the frame, `0`–`1` | `0.2`, `0.2` |
| `lz` | Light height, `0.1`–`2` | `0.45` |
| `lr` | Light spread, `0.2`–`3` | `1.2` |
| `li`, `la` | Intensity `0`–`2`, ambient light `0`–`1` | `0.8`, `0.4` |
| `lc`, `lac` | Light and ambient colours as six hex digits without `#` | `ffffff`, `eef0f8` |
| `ls`, `lf` | Strength and shading smoothness, `0`–`1` | `0.8`, `0.45` |
| `lsp`, `lrim`, `ld` | Gloss, rim light and stroke relief, `0`–`1` | `0.12`, `0.3`, `0.4` |
| `lm` | `soft` or `cel` | `soft` |
| `shadow` | `1` adds the drop shadow | `0` |

Any other `bg` value falls back to transparent. Out-of-range lighting values are clamped,
and invalid ones use the default. **Copy OBS URL** and **Open stream view** include the
Live page's current lighting settings. In OBS, add the URL as a **Browser Source**
(for example 1080 × 1080); the transparent background needs no chroma key. Use green or blue
for software without transparency support.

### How motion reaches the stream view

- The Live page sends numeric pose values (head angles, eyes, gaze, brows, mouth) over the
  dev server's WebSocket, at most 60 times per second. The server accepts only well-formed
  numeric messages and rebroadcasts them; each stream view applies only messages for its own
  `project`.
- When updates stop for one second, the stream view eases back to idle motion.
- Lighting changes on the Live page reach matching stream views the same way. The server
  accepts only complete settings made of numbers and the listed options.
- Tracking runs in a Web Worker, so it continues while the Live page is hidden: in another
  tab, minimised, or behind another window. Frames come from `MediaStreamTrackProcessor` where
  available, otherwise from `requestVideoFrameCallback` or a worker timer. If tracking still
  stops or slows, the Live page shows a warning; bring its window to the front.
- Face Landmarker uses the GPU and switches to the CPU once if the GPU fails or stays slow after
  warm-up.
- With the microphone on, the voice level drives how far the mouth opens and the camera keeps
  the mouth shape. Drawn mouth images are used automatically when the project has them.

### Expressions

The collapsed **Expression** section on the Live page switches the face to Neutral, Smile, Shy, Surprised,
Half-lidded, Angry, Sad or Wink. Keys **1**–**8** do the same while the Live page is focused,
even with the section closed; press the same key or button again to return to Neutral. Keys
typed into a form field are ignored. The section title shows the current expression. Browsers
receive keys only for the focused page; to switch while another app is in front, use
[other apps](#switching-expressions-from-other-apps).

An expression is layered over tracking: blinking, gaze and the mouth keep following the camera
or microphone, while the eyes, brows and blush hold the expression. Switching fades smoothly.
An expression also reaches the stream view without the camera or microphone. Brows hidden
under bangs show less difference between Half-lidded, Angry and Sad.

### Switching expressions from other apps

Keyboard-shortcut apps and button panels such as Stream Deck can switch expressions while
another app is in front. They send a request to the development server, which forwards it to
the Live page; keep the Live page open.

Open **Expression → Switch from other apps** on the Live page to copy the request URL and the
token. Each request is:

- `POST` to the request URL, for example `http://127.0.0.1:5173/__live/expression`
- the header `X-Studio-Token: <token>` (or `Authorization: Bearer <token>`)
- a JSON body such as `{"expression": "smile"}`. Names: `neutral`, `smile`, `shy`, `surprise`,
  `halfLidded`, `angry`, `sad`, `wink`. Add `"project": "<name>"` to reach only the Live page
  for that project.

Sending the expression already shown returns to Neutral, so one shortcut can toggle it.

**macOS Shortcuts**

1. In the Shortcuts app, create a shortcut and add the **Get Contents of URL** action.
2. Enter the request URL, then expand the action: set **Method** to **POST**, add the header
   `X-Studio-Token` with the token, and set **Request Body** to **JSON** with the key
   `expression` and the text value `smile`.
3. In the shortcut's details, choose **Add Keyboard Shortcut** and press the keys to use.
4. Repeat for each expression you want. Run the shortcut once from the app to check it.

**Stream Deck**: use a plugin action that sends web requests in the background, set it to
POST with the same URL, header and JSON body, and assign one button per expression. The
built-in **Website** action opens a browser tab instead, so it does not work for this.

**Command line** (also usable from AutoHotkey or other tools):

```sh
curl -X POST http://127.0.0.1:5173/__live/expression \
  -H "X-Studio-Token: <token>" -H "Content-Type: application/json" \
  -d '{"expression": "smile"}'
```

The token is stored in `projects/.expression-token`, which is excluded from version control.
**Regenerate token** replaces it; shortcuts that use the old token then receive `401`. Only
apps on this machine can reach the server. Websites open in the browser can neither read the
token nor send the token header.

### Privacy

Camera video and microphone audio are processed in the browser and never leave your machine.
Only the numeric pose values above travel over the local WebSocket. The MediaPipe runtime and
model are served locally; no CDN or remote model is requested, and the end-to-end tests fail if
either page makes a request outside `127.0.0.1`.

`@mediapipe/tasks-vision` is pinned to 0.10.21 because newer releases include code that posts
usage logs to Google. Read [vendor/mediapipe/README.md](../vendor/mediapipe/README.md) before
upgrading it.

### Troubleshooting

- **No camera image**: allow camera access when the browser asks. On macOS, also check
  System Settings → Privacy & Security → Camera for your browser. Chrome is recommended.
- **Movement is too small or jittery**: raise **Sensitivity**, or raise **Smoothing**.
  Calibrate again while facing the camera with a relaxed face.
- **Left and right are swapped**: toggle **Mirror**.
- **The stream view stays idle**: keep the Live page open and running, and make sure both pages
  use the same `project`.

## Verify

```sh
npm run lint
npm test
npm run build
uv run --with numpy --with pillow --with opencv-python-headless tools/test_build_layers.py
npx playwright install chromium
npm run e2e
```

`docs/screenshots/` stores local visual verification evidence and is excluded from version control.
