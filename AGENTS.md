# Mesh Avatar Studio

This repository contains a local editor and a data-driven WebGL mesh avatar engine.
To create an avatar from an illustration, follow [docs/agent-guide.md](docs/agent-guide.md)
in order, including coordinate calibration, zoomed grids, overlays and pose review.
Field meanings are in [docs/rig-fields.md](docs/rig-fields.md).
When you change `docs/agent-guide.md` or `README.md`, update every translation
(`docs/agent-guide.*.md`, `README.*.md`) in the same change. If a translation differs,
the English version takes precedence.

- Keep user images and all derived files in `projects/`. Never commit, upload or copy them
  outside this repository. Ask the user before sending an image to any external service.
- `projects/` and scratch `work/` are ignored. Do not stage them or bypass their ignore rules.
- Keep `samples/` and `reference/` unchanged when preparing another illustration.
- Visually inspect generated images before reporting success; report remaining defects.

Use Node.js 22.17+ and Python 3.10+ with `uv`. Run:

```sh
npm run lint
npm test
npm run build
npm run build:runtime
npm run build:element
npm run build:react
npm run e2e
uv run --with numpy --with pillow --with opencv-python-headless tools/test_build_layers.py
uv run tools/test_agent_tools.py
```

The numerical deformation regression must remain 0 px (physics has floating-point tolerance).

## Runtime compatibility

The `mesh-avatar` runtime has existing users. Add features without breaking them:

- Make new avatar features optional data, such as new sprite names or optional rig fields.
  An avatar without that data must render exactly as before; the regression stays 0 px.
- Older runtimes must keep working with avatars made for newer ones. They ignore sprite
  names and rig fields they do not know, so add new ones instead of changing the meaning or
  format of existing fields, sprite names and files.
- Keep the public API compatible: exports of `packages/runtime/src/index.ts`, its types,
  `createMeshAvatar` options and methods such as `setExpression` and `setEmotion`. Add
  optional parameters or new methods instead of changing existing ones.
- Add a changeset only when a package under `packages/` changes: `minor` for a new feature,
  `patch` for a fix. Studio-only changes (the private root package) do not need one. Ask
  the person before any breaking (`major`) change.
Use `npm run validate-rig -- projects/<name>/rig.draft.json` before building and
`npm run render-poses -- projects/<name>` to produce local review images.
