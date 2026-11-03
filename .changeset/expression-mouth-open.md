---
'mesh-avatar': minor
---

Live expressions can set their resting mouth opening with an optional `expressions` block in `avatar.json` or the matching `createMeshAvatar` option, for example `{ "surprise": { "mouthOpen": 0.45 } }`. `loadMeshAvatar` applies the saved values, and explicit option fields override them for each expression. Without the block or the option, every expression keeps its built-in value (surprise 0.6) and the output is unchanged.
