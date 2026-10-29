# Native mesh avatars

[日本語](README.ja.md) · [简体中文](README.zh.md)

> **Experimental.** The native runtime is a work in progress. The crates are not published
> to crates.io. APIs, controls and file locations may change without notice.
> The JavaScript runtime in `packages/runtime` remains the reference implementation.

The Rust runtime loads the same `.mavatar` files and built project folders as the
JavaScript runtime. It includes a transparent desktop avatar, a PNG renderer and Rust/C embedding APIs.
The primary desktop target is macOS with Metal.

## Prerequisites

- Rust 1.88 or newer, with Cargo.
- On macOS, the Xcode Command Line Tools; rendering also needs a Metal-capable GPU.
- For the C examples, `cc` and `make` (verified on macOS). The CPU data API needs no GPU.
- An avatar archive, or a project containing `rig.json`, `built/layers.json` and
  the built PNG assets. The illustration alone is not a playable avatar.

The commands below run from the repository root. The default avatar uses
`samples/miko-qipao`; its images must be installed. The sample's
[asset terms](../samples/miko-qipao/MIKO_ASSET_TERMS.md) apply.

## Embedding

### Rust crates

Add these entries to your application's `Cargo.toml` (not this repository's root):

```toml
[dependencies]
mesh-avatar-core = { git = "https://github.com/shinshin86/mesh-avatar-studio.git", package = "mesh-avatar-core" }
mesh-avatar-wgpu = { git = "https://github.com/shinshin86/mesh-avatar-studio.git", package = "mesh-avatar-wgpu" }
```

These crates are not published to crates.io. Git dependencies use the repository's
default branch; commit your application's `Cargo.lock`, or set `rev` on both entries
to the same commit for reproducible builds. The API may change between revisions.

`mesh-avatar-core` loads avatars, applies controls and advances animation on the CPU;
omit `mesh-avatar-wgpu` if you already have a renderer. `Avatar::tick` returns an owned
`Frame`: draw-ordered layers with vertex positions, UVs, triangle indices, texture
names and alpha, plus frame-wide face uniforms. `Avatar::textures` supplies decoded
straight RGBA8 textures. `mesh-avatar-wgpu::Renderer` draws that frame into a host-provided wgpu
texture view, or reads it back to RGBA. Rust frame data is owned; the C pointer
lifetimes below apply only to the C ABI.

Optional [overlay layers](../docs/format.md#overlay-layers), such as glasses, start
hidden. Call `avatar.set_overlays(&["glasses"])` to show selected names or
`avatar.set_overlays(&[])` to hide all; unknown names are ignored. Overlays follow
the head without brow or jaw deformation, after eye/mouth sprites and before
tassels and the hand, in manifest order. On disk, overlay PNGs match the base image
size; runtime textures and meshes cover only their opaque bounds plus six pixels
of padding. Avatars without overlays keep their existing behavior. Malformed
overlay metadata, missing images and size mismatches are load errors.
If you construct `AvatarPackage` directly, initialize its `overlays` field with
`None` for avatars without overlays.

### C ABI

Build `mesh-avatar-ffi` from this checkout for `libmesh_avatar_ffi.a` and a platform
shared library (`libmesh_avatar_ffi.dylib` on macOS) in `native/target/release/`.
Include [`mesh_avatar.h`](include/mesh_avatar.h). The default library depends only
on core, so hosts with their own mesh renderer do not need wgpu.

Each `mesh_avatar_tick` caches a frame. `mesh_avatar_get_frame` reads its draw-ordered
layers (positions, UVs, triangle indices/counts, alpha and texture IDs) and frame-wide
face uniforms. Texture access returns dimensions and decoded straight RGBA8 pixels.
The host uploads textures and draws
the meshes; the CPU data API does not draw a window or image.

Open a built folder/archive with `mesh_avatar_open_path`, or an in-memory archive
with `mesh_avatar_open_bytes`. Inputs are copied or consumed during the call;
the archive buffer can be released after opening. Handles are opaque `uint64_t`
tokens, with zero invalid. They can move between threads; calls on the same
handle are serialized internally. Always call `mesh_avatar_destroy` when finished.

Frame and layer descriptors contain borrowed, read-only pointers. They remain
valid until the next tick or destroy on that handle; setters leave the cached
frame intact. Texture names and straight RGBA8 pixels remain valid until destroy.
Do not free these pointers. Copy data if it must outlive a tick, and synchronize
borrowed reads against tick/destroy on other threads. Check every `MaStatus`;
`mesh_avatar_last_error` returns a thread-local message until the next API call
on that thread. A contained Rust panic requires destroying and reopening that
handle. The generated header documents pointer/count and ownership requirements.

`mesh_avatar_set_overlays(avatar, names, count)` selects the visible overlays;
`names` is an array of UTF-8 C strings, with at most 200 entries. Unknown names are
ignored. Pass `NULL, 0` to hide all. As with other setters, changes appear on the
next tick; invalid input leaves the selection unchanged.

#### Optional headless rendering

For hosts without their own mesh renderer, enable `render` and copy offscreen pixels instead.

Include [`mesh_avatar_render.h`](include/mesh_avatar_render.h) for this extension.
It includes the CPU header and needs no macro; its functions are exported only
when the library is built with `render`.

Create a renderer with an avatar handle and `MaRenderOptions`: physical width/height,
1 or 4 MSAA samples, contain/cover fit and explicit padding (available from
`mesh_avatar_get_info`). Rendering reads the current cached frame without ticking
and copies tightly packed, top-down RGBA8 into a caller-owned buffer of at least
`width*height*4` bytes. Choose straight or premultiplied alpha. The synchronous
readback does not retain the buffer or invalidate borrowed frame data. Resize
keeps fit/padding/samples; resize the caller's buffer too. Invalid sizes/buffers
return an error without changing the output buffer.

Renderer calls may move between threads and are serialized per renderer and
avatar. Renderers reference their avatar without owning it; destroy renderers
before destroying the avatar. Rendering after avatar destruction returns
`MA_INVALID_HANDLE`. Destroy/recreate objects affected by a contained panic.
`MA_GPU_UNAVAILABLE` means no compatible adapter was found; other GPU errors use
`MA_RENDER_ERROR`. The example/CI skip only the unavailable-adapter case.

### C examples

The examples use `cc` and `make`, link the static library and open
`samples/miko-qipao`. Run the matching build before each example; CPU and `render`
builds write the same library path.

The [data example](examples/c/main.c) applies a pose, ticks, prints mesh/texture
statistics and checks invalid-input behavior:

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-ffi
make -C native/examples/c run
```

The [render example](examples/c/render.c) checks both alpha formats, frame-cache
stability and resize, then writes `native/target/ffi-render.ppm`. PPM has no alpha,
so it composites straight RGBA over white. Neither example opens a window or
captures audio. On macOS, the Makefile links the required Metal/system frameworks
for the render example:

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-ffi --features render
make -C native/examples/c run-render
```

The [terminal example](examples/c/terminal.c) renders the avatar every frame and
draws the RGBA buffer as colored half-block characters, so a terminal is all it
needs. It plays a short loop of motions and kana mouth shapes, follows terminal
resizes and exits with Ctrl+C. Use a 24-bit color terminal such as iTerm2, WezTerm
or Ghostty; a smaller font gives a finer image. Terminal multiplexers may not pass
resizes or colors through reliably. With a frame count after the avatar path, it
prints only the last frame and exits:

```sh
make -C native/examples/c run-terminal
native/target/ffi-terminal-example samples/miko-qipao 90 > native/target/frame.txt
```

## Desktop app

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-desktop
native/target/release/mesh-avatar-desktop
```

Open another avatar:

```sh
native/target/release/mesh-avatar-desktop /path/to/avatar.mavatar
native/target/release/mesh-avatar-desktop /path/to/project
```

Without an argument, the app finds the sample relative to the current source
checkout or the executable. An executable copied elsewhere needs an explicit
avatar path.

The window is transparent, borderless, above normal windows, and has no shadow on
macOS. Its initial width is 400 logical pixels; the height follows the avatar's
image and viewport padding. The bundled sample starts around 400 × 372, with its
flat image edge cropped above the window. Large movements can tighten this crop
slightly to keep that edge hidden. Scaling preserves the window's aspect ratio.
Scroll and keyboard scaling share a 40%–400% range, further limited by the
monitor's size and the GPU's texture limit. Input bursts are combined before
resizing; rendering waits until the surface and window have matching sizes.

On macOS, **File → Open Avatar…** opens a native dialog for either a `.mavatar`
archive or a project folder containing `rig.json` and `built/`. You can also drop
either onto the avatar window. Loading runs in the background; an invalid avatar
leaves the current one displayed and shows an error. A successful switch rebuilds
its GPU resources and viewport, restores the saved placement within the new size limits,
preserves the click-through state, and prints the
new motion list in the terminal.

**File → Open Recent** keeps the last eight successfully opened paths. They are
stored in `mesh-avatar-desktop/recent.json` under the OS user configuration
directory (`~/Library/Application Support/` on macOS). Missing paths are removed
at startup and when the app regains focus. **File → Reload** reopens the current
avatar after edits. Loading a new avatar resets expressions and animation state.

Window position (the outer top-left in logical coordinates) and zoom are saved
per avatar path in `mesh-avatar-desktop/settings.json` in the same configuration
directory. On launch and avatar switches, the app restores that avatar's settings,
or uses the last window placement if that avatar has no saved settings. Restored
windows are fitted to a connected monitor; on macOS this excludes the Dock and
menu bar. Changes are saved after 0.5 seconds without further movement or scaling,
and on normal quit. Missing or corrupt settings use the default placement.

On macOS, **Avatar → Motion** lists every motion by label, and
**Avatar → Expression** selects a live expression. These menus are rebuilt when
switching avatars; the keyboard controls below continue to work.

| Control | Action |
|---|---|
| Command + `O` | Open an avatar archive or built project folder on macOS |
| Command + `R` | Reload the current avatar |
| Drop a `.mavatar` or project folder | Switch avatars in the same window |
| Left-drag | Move the avatar window |
| Scroll | Scale the window |
| Command + `+` / `-` | Scale the window |
| `1`–`9` | Play the first nine built-in motions, listed in the terminal |
| `E` | Cycle live expressions |
| `K` | Run a kana mouth-shape demo; no audio is played |
| `C` | Toggle cursor click-through; off at startup |
| Escape or Command + `Q` | Quit |

Controls apply while the avatar app has keyboard focus. With click-through on,
mouse events go to the window underneath. On macOS, click the monochrome avatar
icon in the system status bar to open its menu. **Hide Avatar / Show Avatar**
toggles the avatar window; the status icon stays available while it is hidden.
**Click-through** has a checkmark when enabled and can turn click-through off
without focusing the avatar. The `C` key and this checkmark use the same state.

The status menu also has **Open Avatar…**, the same **Open Recent** list as the
app menu, and **Quit Mesh Avatar**. Opening an avatar from this menu first shows
the avatar window, including when the file dialog is cancelled. Hiding keeps the
avatar loaded and pauses rendering. Visibility and click-through are not saved;
the avatar starts visible with click-through off on the next launch.

If the status icon is unavailable, use the Dock or Command-Tab to focus the app,
then press `C`. This is not a global shortcut. If focus cannot be restored, quit
from the Dock and relaunch.

Idle movement, blinking, breathing and occasional motions run automatically.
Rendering follows the display's presentation rate. Resizing and monitor scale
changes update the physical render size; animation time steps are capped at
0.05 seconds after a stall or sleep.

## Microphone lip sync (macOS)

The app menu and status menu both have a **Microphone** submenu. Capture is off
at startup. Choose **Enable Microphone** to drive the mouth from input volume;
**Input Device** selects System Default or a named microphone. **Sensitivity**
offers Low, Normal (default), and High. Try High for a quiet voice or Low if
background noise opens the mouth. The noise gate, smoothing and release hold
reduce rapid opening and closing around quiet input.

On first enable, macOS asks for microphone permission. With this unbundled
executable, permission is attributed to the terminal app used to launch it.
Allow that terminal in **System Settings → Privacy & Security → Microphone**
if permission was denied, then enable the microphone again.

Only input levels are used; audio is not recorded or uploaded. This feature does
not capture system playback. Capture stays enabled when the avatar is hidden or
switched. Turn it off from either menu when finished; device, sensitivity and
enabled state are not saved across launches. Disable it before using the `K`
kana demo. Turning it off stops driving the mouth and returns to normal animation.

If a device disconnects, the stream fails, or callbacks stop arriving, the
microphone turns off and the submenu shows **Off:** followed by a reason.
It does not restart automatically. Select an available input and enable it again;
**Input Device → Refresh Devices** refreshes the device list.

## Render a PNG

```sh
cargo run --release --manifest-path native/Cargo.toml -p mesh-avatar-wgpu \
  --bin mesh-avatar-render -- samples/miko-qipao --size 512x640 -o native/target/avatar.png
```

Supply a JSON object such as `{"angleX":20,"mouthOpen":0.8}` with `--pose`.
Unspecified pose parameters use their defaults. `--seconds` advances the avatar
at 60 simulation steps per second before rendering. `--help` lists options for
viewport padding, fit, expressions and multisampling.

## Development checks

All shell commands here also run from the repository root. Node.js 22.17 or newer
and the npm dependencies are needed for comparison with the JavaScript runtime.
Install those dependencies with `npm ci` if they are not already installed.

```sh
node --experimental-strip-types native/conformance/dump.mjs
cargo test --manifest-path native/Cargo.toml --all-features
cargo clippy --manifest-path native/Cargo.toml --all-targets --all-features -- -D warnings
cargo fmt --manifest-path native/Cargo.toml --all --check
```

The dump first checks the embedded motion data, then writes numeric reference data
to ignored `native/target/conformance/`. Generate it before running the tests;
comparison tests report a skip when it is absent. Tests without a compatible GPU
skip GPU readback checks. Core also compiles for WASM; this does not provide
JavaScript bindings:

```sh
rustup target add wasm32-unknown-unknown
cargo check --manifest-path native/Cargo.toml -p mesh-avatar-core --target wasm32-unknown-unknown
```

Normal library builds do not need cbindgen. For header maintenance, install the
pinned tool into the ignored build directory, regenerate both headers, then check
for drift:

```sh
cargo install cbindgen --version 0.29.4 --locked --root native/target/header-tools
bash native/conformance/ffi-header.sh
bash native/conformance/ffi-header.sh --check
```

CI checks WASM, formatting/lints/tests, both generated headers and both C examples. The C render example skips only when no compatible GPU adapter is available.

### Pixel comparison

This optional command launches headless Chromium and the offscreen renderer. It
requires the npm dependencies, a Playwright Chromium installation and a compatible
GPU; the script builds the debug renderer itself:

```sh
npx playwright install chromium
node native/conformance/compare-pixels.mjs
```

PNG images and reports stay in ignored `native/target/pixel-comparison*/`.
On macOS, `--metal` selects Chromium's Metal backend; `--dpr=2` compares equal
physical sizes at HiDPI. To intentionally update the embedded motion definitions,
run `node --experimental-strip-types native/conformance/sync-motion-data.mjs`.

## Limitations

- Windows and Linux desktop behavior has not been verified. Window transparency,
  always-on-top behavior and cursor click-through depend on the OS compositor.
  The app exits if a transparent surface is unavailable.
- The native menu bar, status-bar icon and Open Avatar dialog are macOS-only. The executable
  embeds the name “Mesh Avatar” without an app bundle; the name shown elsewhere
  by macOS can depend on how it was launched.
- Microphone capture is currently macOS-only. Camera tracking, system-audio
  capture, audio playback and lighting are not included.
- The desktop is a Cargo-built executable, without an installer, signed app
  bundle or global keyboard shortcuts.
- GPU rasterization and antialiasing can differ slightly from Chromium. Compare
  premultiplied colors when inspecting nearly transparent image edges.
