# Avatar file and folder format

Version 1 uses the same files in a project folder and a `.mavatar` archive. A project
folder is the working copy; a `.mavatar` is a ZIP containing those files at its root.
The rig describes motion in source-image coordinates, and the built PNGs provide the
textures. See [Rig fields](rig-fields.md) for the geometry and deformation settings.

## Files

```text
avatar.json                    manifest; required in an archive, optional in a folder
rig.json                       complete version 1 rig, including sampled eye curves
built/
  layers.json                  image size, layer rectangles and sampled eye curves
  base.png                     image with movable parts removed and inpainted
  base_cloth.png               required only for nonempty rig.cloth; base without garments
  cloth_<name>.png              garment cutout for each rig.cloth entry
  hairmask.png                 full-size hair mask, read from the red channel
  <name>.png                   one image for every entry in layers.json.layers
  sprites/                     optional drawn eye and mouth variants
    sprites.json               sprite rectangles
    <name>.png                 one image for every entry in sprites.json.layers
  overlays/                    optional overlay layers (glasses and other accessories)
    overlays.json              overlay names and image files
    <file>.png                 one full-size image for every entry in overlays.json.overlays
source.png                     optional original illustration; needed for editing
thumbnail.png                  optional preview image
```

`base.png` and `hairmask.png` are required even when they have no rectangle entry in
`layers.json`. Hand and accessory layers are required only when the rig contains those
parts. The entire `sprites/` directory can be absent. The renderer then animates the
generated eye layers and procedural mouth without drawn variants. The `overlays/`
directory is optional as well; without it the avatar renders exactly as before.

Readers ignore unknown files and unknown JSON keys. A project may also contain drafts,
source variants, masks and review images; these are not required for playback.

For nonempty `rig.cloth`, `base_cloth.png` is a full-size image and every garment has a
`cloth_<name>` rectangle in `layers.json.layers` with a matching cropped PNG. Players
draw rear garments, `base_cloth`, eye/mouth layers, front garments, accessories, then
the optional hand. `base.png` retains the garments so older players still show the
clothed illustration. `pack-avatar` includes both bases and the garment cutouts.
The optional editing input `source_under.png` has the same dimensions and alignment
as `source.png`, with only garments removed; it is not needed for playback and is
not included by `pack-avatar`. Without it the layer builder inpaints the covered area.

## Manifest: `avatar.json`

```json
{
  "format": "mesh-avatar",
  "version": 1,
  "name": "My avatar",
  "author": "Artist name",
  "source": "source.png",
  "thumbnail": "thumbnail.png",
  "studio": { "version": "0.1.0" }
}
```

| Field | Meaning |
| --- | --- |
| `format` | Required literal `"mesh-avatar"`. |
| `version` | Required format version, currently `1`. |
| `name` | Required non-empty display name. It is not a filesystem path. |
| `author` | Optional author or attribution string. |
| `license` | Optional license text or reference to the artwork's terms. The runtime's MIT license does not grant rights to the artwork. |
| `source` | Optional original-image filename relative to the root, normally `source.png`. |
| `thumbnail` | Optional preview-image filename relative to the root, normally `thumbnail.png`. |
| `lipSync` | Optional mouth-movement settings: `granularity`, `openness`, `closeSpeed` (each optional, finite 0–1, default 0.5). Optional `preset` records the editor selection (`calm`, `default`, `lively`, `subtle`, `big`, `custom`); playback always uses the numbers. An omitted or empty block preserves existing behavior. |
| `studio.version` | Optional version string identifying the Studio that prepared the avatar. |

For example, `"lipSync": { "granularity": 0, "openness": 0.5, "closeSpeed": 0,
"preset": "calm" }` selects smoother, less frequent closures. Low `granularity` reacts only
to large loudness dips and groups short kana morae; high values separate smaller dips.
`openness` scales mouth opening from 0.55 to 1.25 times the original amount (capped at 1),
with exactly the original amount at 0.5. `closeSpeed` changes release from slow to quick.
All three default to 0.5, preserving the existing animation exactly. `preset` does not
change the numeric values or cause playback.

The editor saves this block independently of the rig and preserves it on export/import.
Preview audio is never stored in the archive. Loaders and Live/Player apply saved settings;
explicit runtime settings override the corresponding saved fields. Audio-driven lip sync
requires an application supplying analyzed loudness. Loading an avatar alone does not
start a microphone. Older readers ignore this optional key. Format version and existing
fields are unchanged. Unknown fields in the block are ignored.

On import, Studio saves the original image as `source.png` and updates `avatar.json.source` when its filename differs.

An existing folder without `avatar.json` has the effective manifest
`{ "format": "mesh-avatar", "version": 1, "name": "<folder name>" }`.
Archives must contain an explicit manifest. `parseManifest` validates known fields,
returns a new object containing those fields, and throws an error naming `avatar.json`
when they are invalid. It ignores unknown keys, including those inside `studio`.

## Built layers: `built/layers.json`

| Field | Meaning |
| --- | --- |
| `version` | Metadata version `1`; omission also means `1`. |
| `size` | `[width, height]` in source pixels, exactly matching `rig.image`. Both dimensions are positive integers. |
| `build` | Non-empty cache-busting hash of build inputs. It is not a format version. |
| `layers` | Object mapping each layer name to `[x, y, width, height]`. |
| `eyes` | Two objects containing `x0`, `x1`, `top` and `bot`, in the same eye order as the rig. |

Rectangle origins are non-negative integers; width and height are positive integers.
Rectangles lie inside the source image. Each corresponding PNG is cropped to its
rectangle's width and height. Names use letters, digits, hyphens or underscores, with
no extension or path separator.

| Reserved name | Contents |
| --- | --- |
| `base` | Full-size illustration after removing the eyes, optional hand and accessories and inpainting the exposed areas. |
| `hairmask` | Full-size mask whose red channel controls hair deformation. |
| `hand` | The movable hand and arm cutout; present when `rig.hand` exists. |
| `eye0_ball`, `eye1_ball` | Eye white and iris, clipped by the eyelid curves at runtime. |
| `eye0_low`, `eye1_low` | Lower eyelid strokes. |
| `eye0_crease`, `eye1_crease` | Eyelid crease strokes. A transparent image is valid when no crease is drawn. |
| `eye0_lash`, `eye1_lash` | Upper lash strokes. |

All four parts are required for each eye. Accessory names come from
`rig.accessories[*].name`; each needs a rectangle and a corresponding PNG.
Accessory names must be unique and must not reuse reserved layer names.

Each eye spans finite `x0 < x1` values. `top` and `bot` each contain 24 finite y
coordinates sampled across that span; every top value is at or above its bottom value.
These fields duplicate `rig.eyes[*].x0`, `x1`, `top` and `bot`. The layer builder writes
both copies, and their values must agree exactly. A future format may keep them only
in `layers.json`; version 1 requires both.

## Drawn variants: `built/sprites/sprites.json`

The optional sprite metadata contains `version`, `build` and `layers`.
`version` is `1` (or omitted for older files), and `build` is a cache-busting hash.
`layers` is a rectangle map, just like the layer metadata:

```json
{
  "build": "example-build-hash",
  "layers": {
    "mouth_a": [100, 200, 80, 40]
  },
  "version": 1
}
```

Each listed sprite has a PNG under `built/sprites/`. It uses the same source-pixel
rectangle convention, including bounds and integer requirements. Sprites are optional
individually; readers must not require a complete set.

| Name | Drawing |
| --- | --- |
| `eyes_closed_0`, `eyes_closed_1` | Closed eyes with relaxed lids. |
| `eyes_half_0`, `eyes_half_1` | Half-open eyes. |
| `eyes_smile_0`, `eyes_smile_1` | Closed eyes in a smile. |
| `eyes_sad_0`, `eyes_sad_1` | Open eyes for the sad expression. |
| `eyes_surprise_0`, `eyes_surprise_1` | Wide-open eyes for the surprised expression. |
| `mouth_a` | Open mouth for “a”. |
| `mouth_a_half` | Partly open “a”; also reused for “e”. |
| `mouth_i` | Wide mouth for “i”. |
| `mouth_o` | Rounded mouth for “o”; also reused, with reduced width, for “u”. |
| `mouth_angry` | Closed mouth for the angry expression (corners turned down). |
| `mouth_sad` | Closed mouth for the sad expression (corners drooping). |

The eye suffix is the index in `rig.eyes`, not a separate left/right convention.
The expression eyes replace the open and half-open eye while the live expression
(`setExpression`: `sad`, `surprise`) or the emotion tag (`setEmotion`: `sad`, `surprised`)
is active; a blink still switches to `eyes_closed`. They cover the same area as the other
eye drawings and do not include the eyebrows, which the rig moves. The angry expression
keeps `eyes_half`. The expression mouths replace the closed mouth while the angry or sad
expression or emotion tag is active; while speaking, the open mouth drawings are shown over
them. Without these drawings, those expressions look as before.
Otherwise the original base drawing provides the closed mouth.

## Overlay layers: `built/overlays/overlays.json`

Overlay layers are optional full-size drawings, such as glasses, that an app shows or
hides by name with `setOverlays`. The metadata contains `version` and `overlays`.
`version` is `1` (or omitted). `overlays` is an array of `{ name, file }` entries:

```json
{
  "overlays": [
    { "name": "glasses", "file": "glasses.png" }
  ],
  "version": 1
}
```

`name` and the file stem use letters, digits, `_` and `-`; `file` ends in `.png`, and
names must be unique. Each image lives under `built/overlays/`, is the same size as
`base.png` and is drawn in source-image coordinates, transparent outside the accessory.
The runtime meshes only the opaque area (plus a few pixels of padding), so a small
accessory stays cheap to animate.

All overlays start hidden. `setOverlays(['glasses'])` shows the listed overlays and hides
the others; unknown names are ignored, and `setOverlays([])` hides them all. Hidden
overlays are not deformed. Overlays are drawn above the drawn eye and mouth variants and
below the tassels and hand, and follow the head and body like the base drawing. Eyebrow,
jaw and hair movement do not move them.

Runtimes that do not know overlays ignore the directory, so an avatar with overlays still
plays on them without the accessories.

## Archive rules and compatibility

A `.mavatar` file is a ZIP with stored entries (compression method 0), UTF-8 names and
forward slashes. Put `avatar.json`, `rig.json` and `built/` directly at its root, without
a wrapping project directory. Entry names must not be absolute paths, contain `..`
segments or use backslashes. Importers reject archives with more than 200 entries or
any entry larger than 64 MB.

Missing `avatar.json` is allowed only for folders. Missing `version` is allowed only
in `layers.json`, `sprites.json` and `overlays.json`, where it means `1`. `rig.json` and any present
`avatar.json` must specify version `1`. Readers reject unsupported versions with an
error identifying the file and version, such as
`built/layers.json.version: unsupported version 2 (expected 1)`.
Unknown entries and unknown object keys do not change the interpretation of known
fields. A listed layer or sprite still requires its PNG, even if its name is unfamiliar.
When loading a folder, `openAvatar` fills missing `eyes[*].x0`, `x1`, `top` and `bot`
fields from `layers.json.eyes` before validating the rig; existing values are preserved.

Include `source.png` by default when preparing an archive for re-editing. It can be
omitted for playback, but `built/base.png` already contains most of the illustration:
omitting the source offers little protection for the artwork. Check the artwork's
terms before sharing any of these files.

## Pack and validate

From the repository root, after installing Node dependencies:

```sh
npm run validate-avatar -- samples/miko-qipao
npm run validate-avatar -- projects/my-avatar
npm run pack-avatar -- projects/my-avatar
npm run validate-avatar -- projects/my-avatar.mavatar
npm run pack-avatar -- projects/my-avatar --no-source -o projects/playback.mavatar
```

Validation accepts folders and `.mavatar` files. It reads regular files without
following symlinks, returns exit status 0 for valid input and 1 for invalid input,
and prints errors with the affected relative filename. Archives require `avatar.json`.
Packing writes a sibling `.mavatar` by default and refuses to overwrite an existing
output. It includes the manifest, rig, built assets and optional thumbnail and source;
drafts, variants and work files are excluded. `--no-source` omits the original image.
Folders without a manifest get one whose name is the folder name.

`validateAvatarFiles(files)` performs the same checks without filesystem or network
access. Pass a map from root-relative, forward-slash paths to `Uint8Array` bytes.
For images, `{ size: number }` can stand in for bytes; JSON always needs bytes. The
validator checks JSON schemas, supported versions, required non-empty files, rectangle
bounds, matching image-size metadata and matching eye curves. It ignores unknown
files and JSON fields and leaves the input unchanged. It does not decode PNGs or
verify that their actual dimensions match the rectangles, and it does not judge
artwork or animation quality. Review the rendered avatar after validation.

## Runtime loading

`openAvatar(source, { version?, rigFile? })` accepts a folder URL, a `.mavatar` URL,
`Blob`, `ArrayBuffer`, `Uint8Array`, or an already-open `AvatarPackage`. Binary inputs
are archives; URL paths ending in `.mavatar` are fetched as archives. Other URLs are
folders. Relative URLs resolve against the current page. An existing package is
returned unchanged. For folders, `rigFile` selects the rig filename (default
`rig.json`), and `version` adds a `v` query parameter to metadata and image URLs.
Optional manifest, sprite or overlay metadata may be absent; other HTTP errors are reported.
Folder images remain URLs and are read by the renderer.

The returned package contains `manifest`, validated `rig`, an `assets` URL map and
`release()`. Archive assets use object URLs; call `release()` when finished with an
`openAvatar` package. Repeated calls are safe. Folder packages allocate no object URLs.

`loadMeshAvatar(canvas, source, options)` opens the source and creates an avatar with
the existing motion and expression API. The returned avatar also exposes `package`.
Destroying it releases a package that the loader opened, including on creation
failure. If the caller supplied an existing package, the caller retains ownership
and must release it after all avatars using it are finished.

`packAvatar(files, { manifest? })` validates and packs a byte map with `avatar.json`
first. Existing files, including manifest bytes, are retained unless a manifest
override is supplied. Without an existing manifest, the default name is `Avatar`.
`unpackAvatar(bytes)` checks archive paths and limits and returns the byte map;
use `validateAvatarFiles` or `openAvatar` to validate the avatar contents.

The stream view accepts `?avatar=<folder-or-.mavatar-URL>`. An explicit `project`
query parameter takes precedence when both are present.
