# Mesh Avatar Studio

This repository contains a local editor and a data-driven WebGL mesh avatar engine.
To create an avatar from an illustration, follow [docs/agent-guide.md](docs/agent-guide.md)
in order, including coordinate calibration, zoomed grids, overlays and pose review.
Field meanings are in [docs/rig-fields.md](docs/rig-fields.md).

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
npm run e2e
uv run --with numpy --with pillow --with opencv-python-headless tools/test_build_layers.py
uv run tools/test_agent_tools.py
```

The numerical deformation regression must remain 0 px (physics has floating-point tolerance).
Use `npm run validate-rig -- projects/<name>/rig.draft.json` before building and
`npm run render-poses -- projects/<name>` to produce local review images.
