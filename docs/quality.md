# Deformation and motion metrics

Run locally with Node.js 22.17+ after `npm ci`:

```sh
npm run quality -- samples/miko-qipao
npm run quality -- projects/example --seconds 60 --seed 173 --out work/quality/example
```

The command runs without a browser and writes `report.json` plus console summary tables.
The default output is `work/quality/<folder-name>/`, excluded from version control. Project
and output paths must stay inside the repository; output cannot overwrite the input
project or anything under `projects/`, `samples/` or `reference/`. Nothing is uploaded. Only `rig.json` is required.
Missing built images produce notices and skip the affected layer meshes; an incomplete
sprite set is skipped as a whole, matching the runtime fallback. Without a hair
mask, the full-image grid uses geometric hair-strand influence everywhere; these results
are not directly comparable with a run using the actual mask.

## Static deformation

The report includes the pose-review set, smiling eyes and vowel mouths, and all 16
combinations of head X ±30°, Y ±15°, roll ±15° and body roll ±10°, with the mouth open
and eyes closed. Each pose runs with zero physics and fixed hair/bun offsets. Fixed
tassel joint angles are ±0.18 and ∓0.30 radians, alternating sides. These are stress
poses, not frames sampled from an animation.

An opaque triangulated 7 px grid covers the whole image, including transparent areas.
When available, built images supply the runtime's alpha-filtered layer meshes at the
rig's mesh densities. Base, hand, eyelids, drawn sprites and tassels use their runtime
deformation paths. Inactive sprites are marked as skipped because the runtime does not
place them; hidden eye parts retain metrics with `visible: false`. Sprite presence keeps
layered eyelids fully open, matching the renderer. The measurements cover CPU mesh
geometry; fragment-shader clipping, painted mouth shapes and iris travel are excluded.

| Metric | Interpretation |
|---|---|
| `flipped` | Triangle orientation reversed, or signed deformed/rest area ratio below 1e-6 |
| `areaRatio` | Signed area ratio: min, 1st percentile, 99th percentile and max; 1 preserves area |
| `anisotropy` | Largest/smallest singular value of the triangle's affine map; 1 is isotropic |
| `stretch` | max(largest singular value, inverse smallest); 1 preserves lengths |
| `maxDisplacement` | Largest vertex movement in source pixels |
| `worst` | Extreme triangle indices and centroid in rest coordinates, plus its deformed centroid; displacement uses the vertex location |

Singular maps use the string `"Infinity"` in JSON. Empty meshes use null statistics.
Degenerate rest triangles are counted separately and excluded from area/stretch statistics.
Static percentiles use nearest ranks. The console's flip count sums all measured pose/physics
combinations, including hidden eye parts, so it is not a count of unique triangles.

## Temporal motion

Each scenario starts fresh, uses the same seeded random generator, and advances at 60 fps
for `--seconds` (default 30, rounded to whole frames, minimum 3 frames). The scenarios are
idle wandering with automatic idle motions, every motion ID in sequence, a fixed looping
kana sentence, and six emotion tags. Automatic reaction playback is disabled; only the
idle scenario enables automatic idle motions. Motion IDs receive equal time slots, so a
short run interrupts longer clips. `schedule` records every start and whether the clip is
truncated; `cut` identifies interruption by the next event, while `truncated` also covers
the simulation ending before a clip finishes. Increase the duration to at least the number of IDs times the longest clip's
duration for complete playback of every clip. Randomness is restored after each scenario.

- Parameter `p99`/`max` measure absolute second differences per frame (the requested
  jerkiness indicator, not a third time derivative); reversals ignore changes ≤1e-8.
- Vertex jitter is the Euclidean second difference in pixels/frame² on the 7 px grid.
  Regions are disjoint: hair has strand weight ≥0.02, head has head weight ≥0.5 among
  remaining vertices, and body contains the rest. Positions use the runtime's Float32
  mesh buffers. P99 uses bounded-memory logarithmic bins with at most 0.1% relative
  overestimation above 1e-12 px; max is exact. Empty regions report null.
  `vertexJitterExcludingEvents` also excludes samples centred within ±3 frames of each
  scheduled start. `eventExclusion` gives the radius and retained/excluded frame counts;
  `vertexJitter` keeps the raw measurements. Compare both to identify scenario-switching
  artifacts. A ±3 frame exclusion does not remove longer settling after a switch.
- Hair reports the greatest increase in adjacent fringe-tip distance over rest, its
  greatest ratio to rest distance, and the largest physical tip offset relative to each
  strand's configured `max`. Fringe neighbours follow rig order. Tip distances include
  head/body transforms; offset ratios use physics offsets before those transforms.
- Tassels report each joint's minimum, maximum, range (radians), and reversals/second.

Use the same rig, images, duration and seed for comparisons. The JSON omits timestamps
and absolute paths so identical inputs and seed give byte-identical reports. These
numbers locate deformation and abrupt movement; they do not judge artwork or animation
appeal. Startup transients, blinking and deliberate expression changes are included.

## Default-motion compatibility

`tests/motion-trace.test.ts` samples current parameters and physics for four seeded 20 s
scenarios every second and at the final frame, rounded to 1e-6. The fixture needs only the
sample rig, not its images. Parameters, buns, strands and tassels are keyed by name.
Existing fixture parameters must match the rounded trace exactly; physics may differ by
at most 1e-6. New keys are logged and allowed without weakening comparisons of the
existing keys. Regenerate only after reviewing an intentional baseline change:

```sh
UPDATE_MOTION_TRACE=1 npx vitest run tests/motion-trace.test.ts
```
