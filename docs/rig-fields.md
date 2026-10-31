# Rig fields

See the [avatar file and folder format](format.md) for the manifest, built images and
metadata that accompany `rig.json`.

Version 1 uses the original `source.png` coordinate system: origin at the top left, x right,
y down. Coordinates, radii, lengths, grid spacing and bands are **source pixels**; angles are
**radians**, not the degrees used by the pose sliders. All numbers must be finite. Ellipse
radii and mesh cell sizes must be positive. Mesh cell sizes and fine-mesh rectangle
coordinates must be integers. Accessory boxes must be integer rectangles inside the image. A band is `[start, end]` with `start < end`.
Ellipses are smooth influence regions, not hard cut-out boundaries.

Only `buns`, `strands`, `accessories`, `hand` and `view.gazeCenter` are optional. Omit absent
optional groups. Required regions must still be placed even if their animation will be small.
The initial draft has empty eye polygons and is intentionally invalid until they are traced.
See [agent-guide.md](agent-guide.md) for the process and [rig-mapping.md](rig-mapping.md) for
the engine mapping. Do not copy the example illustration's coordinates into a new image.

| Field | Meaning, unit and placement |
|---|---|
| `version` | Schema version; set to `1`. |
| `image.width` | Original PNG width, px; exact image dimensions. |
| `image.height` | Original PNG height, px; exact image dimensions. |
| `head.cx` | Head influence centre x, px; near the horizontal face centre. |
| `head.cy` | Head influence centre y, px; slightly above the eyes. |
| `head.rx` | Horizontal head radius, px; include hair and head accessories. |
| `head.ry` | Vertical head radius, px; include crown and hair, avoid shoulders where possible. |
| `head.shiftX` | Maximum horizontal face-turn displacement, px; start around 3–4% of image width. |
| `head.shiftY` | Maximum vertical face-turn displacement, px; start around 2–3% of image height. |
| `head.pivotX` | Head roll pivot x, px; centre of the neck. |
| `head.pivotY` | Head roll pivot y, px; at the neck above the collarbone. |
| `head.maxRoll` | Roll magnitude at a ±30° head pose, radians; start near `0.15`. |
| `head.weightBand` | Y range, px, where head influence fades from full to zero; below chin to collarbone. |
| `head.turnBand` | Y range, px, where face-turn displacement fades; below chin into upper chest. |
| `body.pivotX` | Body roll pivot x, px; middle of the lower torso. |
| `body.pivotY` | Body roll pivot y, px; near the bottom of the image. |
| `body.maxRoll` | Body rotation at a ±10° body pose, radians; start near `0.035`. |
| `body.breathBand` | Y range, px, where breathing fades to zero; upper chest to bottom. |
| `body.rollBand` | Y range, px, where body roll fades to zero; upper body to anchored lower torso. |
| `body.chest.cx` | Chest centre x, px; centre of visible upper torso. |
| `body.chest.cy` | Chest centre y, px; below neck and above lower torso. |
| `body.chest.rx` | Chest horizontal radius, px; cover torso inside the arms. |
| `body.chest.ry` | Chest vertical radius, px; cover breathing region. |
| `body.shoulders[*].cx` | Shoulder centre x, px; one ellipse per visible shoulder. |
| `body.shoulders[*].cy` | Shoulder centre y, px; on the visible shoulder. |
| `body.shoulders[*].rx` | Shoulder horizontal radius, px; cover shoulder width. |
| `body.shoulders[*].ry` | Shoulder vertical radius, px; cover shoulder height. |
| `face.nose.cx` | Horizontal centre, px; Nose influence ellipse, px; centre on nose tip, radii around bridge/tip region. |
| `face.nose.cy` | Vertical centre, px; Nose influence ellipse, px; centre on nose tip, radii around bridge/tip region. |
| `face.nose.rx` | Horizontal influence radius, px; Nose influence ellipse, px; centre on nose tip, radii around bridge/tip region. |
| `face.nose.ry` | Vertical influence radius, px; Nose influence ellipse, px; centre on nose tip, radii around bridge/tip region. |
| `face.mouth.cx` | Horizontal centre, px; Mouth movement influence ellipse, px; centre on lips, extend slightly into surrounding skin. |
| `face.mouth.cy` | Vertical centre, px; Mouth movement influence ellipse, px; centre on lips, extend slightly into surrounding skin. |
| `face.mouth.rx` | Horizontal influence radius, px; Mouth movement influence ellipse, px; centre on lips, extend slightly into surrounding skin. |
| `face.mouth.ry` | Vertical influence radius, px; Mouth movement influence ellipse, px; centre on lips, extend slightly into surrounding skin. |
| `face.eyeA.cx` | Horizontal centre, px; Image-left eye influence ellipse, px; cover eye and immediate surrounding skin. |
| `face.eyeA.cy` | Vertical centre, px; Image-left eye influence ellipse, px; cover eye and immediate surrounding skin. |
| `face.eyeA.rx` | Horizontal influence radius, px; Image-left eye influence ellipse, px; cover eye and immediate surrounding skin. |
| `face.eyeA.ry` | Vertical influence radius, px; Image-left eye influence ellipse, px; cover eye and immediate surrounding skin. |
| `face.eyeB.cx` | Horizontal centre, px; Image-right eye influence ellipse, px; cover eye and immediate surrounding skin. |
| `face.eyeB.cy` | Vertical centre, px; Image-right eye influence ellipse, px; cover eye and immediate surrounding skin. |
| `face.eyeB.rx` | Horizontal influence radius, px; Image-right eye influence ellipse, px; cover eye and immediate surrounding skin. |
| `face.eyeB.ry` | Vertical influence radius, px; Image-right eye influence ellipse, px; cover eye and immediate surrounding skin. |
| `face.earL.cx` | Horizontal centre, px; Image-left ear influence ellipse, px; centre on the ear location, even when hidden. |
| `face.earL.cy` | Vertical centre, px; Image-left ear influence ellipse, px; centre on the ear location, even when hidden. |
| `face.earL.rx` | Horizontal influence radius, px; Image-left ear influence ellipse, px; centre on the ear location, even when hidden. |
| `face.earL.ry` | Vertical influence radius, px; Image-left ear influence ellipse, px; centre on the ear location, even when hidden. |
| `face.earR.cx` | Horizontal centre, px; Image-right ear influence ellipse, px; centre on the ear location, even when hidden. |
| `face.earR.cy` | Vertical centre, px; Image-right ear influence ellipse, px; centre on the ear location, even when hidden. |
| `face.earR.rx` | Horizontal influence radius, px; Image-right ear influence ellipse, px; centre on the ear location, even when hidden. |
| `face.earR.ry` | Vertical influence radius, px; Image-right ear influence ellipse, px; centre on the ear location, even when hidden. |
| `face.brow.cx` | Horizontal centre, px; Brow influence ellipse, px; cover the visible eyebrow region, avoiding hair. |
| `face.brow.cy` | Vertical centre, px; Brow influence ellipse, px; cover the visible eyebrow region, avoiding hair. |
| `face.brow.rx` | Horizontal influence radius, px; Brow influence ellipse, px; cover the visible eyebrow region, avoiding hair. |
| `face.brow.ry` | Vertical influence radius, px; Brow influence ellipse, px; cover the visible eyebrow region, avoiding hair. |
| `face.brow.band` | Y range, px, fading brow movement from full to zero below brow. |
| `face.jaw.cx` | Horizontal centre, px; Jaw influence ellipse, px; centre just above chin, cover lower jaw. |
| `face.jaw.cy` | Vertical centre, px; Jaw influence ellipse, px; centre just above chin, cover lower jaw. |
| `face.jaw.rx` | Horizontal influence radius, px; Jaw influence ellipse, px; centre just above chin, cover lower jaw. |
| `face.jaw.ry` | Vertical influence radius, px; Jaw influence ellipse, px; centre just above chin, cover lower jaw. |
| `face.jaw.band` | Y range, px, fading jaw influence from zero to full toward chin. |
| `buns.bunL.cx` | Horizontal centre, px; Optional image-left bun ellipse, px; include whole bun, exclude ribbons. |
| `buns.bunL.cy` | Vertical centre, px; Optional image-left bun ellipse, px; include whole bun, exclude ribbons. |
| `buns.bunL.rx` | Horizontal influence radius, px; Optional image-left bun ellipse, px; include whole bun, exclude ribbons. |
| `buns.bunL.ry` | Vertical influence radius, px; Optional image-left bun ellipse, px; include whole bun, exclude ribbons. |
| `buns.bunR.cx` | Horizontal centre, px; Optional image-right bun ellipse, px; include whole bun, exclude ribbons. |
| `buns.bunR.cy` | Vertical centre, px; Optional image-right bun ellipse, px; include whole bun, exclude ribbons. |
| `buns.bunR.rx` | Horizontal influence radius, px; Optional image-right bun ellipse, px; include whole bun, exclude ribbons. |
| `buns.bunR.ry` | Vertical influence radius, px; Optional image-right bun ellipse, px; include whole bun, exclude ribbons. |
| `eyes` | Exactly two entries: index `0` is image-left, index `1` image-right (not anatomical left/right). |
| `eyes[*].opening` | Polygon `[x,y]` points, px; trace eye white + iris inside lashes, 14–20 points from outer corner. |
| `eyes[*].roi` | Polygon `[x,y]` points, px; surround full lashes and lower lid by about 10–20 px, avoid hair. |
| `eyes[*].x0` | Generated leftmost opening x, px; omit in draft, builder computes it. |
| `eyes[*].x1` | Generated rightmost opening x, px; omit in draft, builder computes it. |
| `eyes[*].top` | Generated 24 upper-edge y samples, px, evenly spaced x0→x1; omit in draft. |
| `eyes[*].bot` | Generated 24 lower-edge y samples, px, evenly spaced x0→x1; omit in draft. |
| `mouth.cx` | Closed mouth line centre x, px; between lip corners. |
| `mouth.cy` | Centre y of the straight line through lip corners, px; bow adds curvature. |
| `mouth.angle` | Angle of lip-corner line, radians; positive slopes down to image-right. |
| `mouth.halfLen` | Half length of lip-corner line, px; centre to either corner. |
| `mouth.bow` | Downward curvature at the middle of mouth line, px; zero for a straight line. |
| `mouth.area.cx` | Mouth sprite influence centre x, px; centre on lips. |
| `mouth.area.cy` | Mouth sprite influence centre y, px; centre on lips. |
| `mouth.area.rx` | Mouth edit region horizontal radius, px; slightly beyond corners. |
| `mouth.area.ry` | Mouth edit region vertical radius, px; allow drawn open mouths without reaching chin. |
| `mouth.area.angle` | Mouth edit ellipse rotation, radians; follow mouth line. |
| `cheeks` | Exactly two `[x,y]` blush centres, px; image-left then image-right cheek. |
| `strands[*].name` | Nonempty label for the hair lock; use distinct readable names. |
| `strands[*].nodes` | Root-to-tip polyline of `[x,y]` points, px; start with four nodes entirely on hair. |
| `strands[*].sigma` | Width of strand influence, px; around half the visible lock width. |
| `strands[*].k` | Positive spring response multiplier, unitless; start near `1`. |
| `strands[*].max` | Maximum hair displacement, px; start around 7–12. |
| `accessories[*].name` | Unique safe layer filename stem (letters/digits/underscore/hyphen), not a reserved layer name. |
| `accessories[*].pivot` | Hanging accessory root `[x,y]`, px; fixed attachment point. |
| `accessories[*].tip` | Hanging accessory endpoint `[x,y]`, px; bottom of pendant/tassel. |
| `accessories[*].split` | Split position along two-bone accessory, fraction strictly between 0 and 1; start near `0.4`. |
| `accessories[*].box` | Integer `[x0,y0,x1,y1]` search rectangle, px; tightly bound accessory, x1/y1 exclusive. |
| `accessories[*].color.redness` | Minimum `(R-max(G,B))/max(R,1)` ratio, 0–1; builder currently isolates red accessories only. |
| `accessories[*].color.minRed` | Minimum red channel, 0–255; suppress dark background inside box. |
| `hand.outline` | Polygon `[x,y]` points, px; trace the entire visible hand/forearm to cut out. |
| `hand.jaw` | Visible jaw polyline `[x,y]`, px; sample both sides of the hand occlusion for interpolation. |
| `hand.jawRange` | Increasing x range, px; jaw segment to reconstruct behind hand. |
| `hand.background` | Polygon `[x,y]` points, px; background-side region behind hand, below jaw. |
| `hand.elbow` | Elbow pivot `[x,y]`, px; may be outside the visible image. |
| `hand.wrist` | Wrist pivot `[x,y]`, px; at wrist joint. |
| `hand.knuckle` | Finger rotation pivot `[x,y]`, px; at knuckle near the face. |
| `hand.contact` | Fingertip contact `[x,y]`, px; point pinned near chin as head moves. |
| `hand.forearmShare` | Fraction 0–1 of arm rotation applied to forearm; start near `0.3`. |
| `hand.armBand` | Y range, px, fading arm rotation to zero toward bottom of arm. |
| `hand.wristBand` | Y range, px, fading wrist rotation to zero below wrist. |
| `hand.handBand` | Y range, px, fading head/contact following below hand. |
| `hand.fingerXBand` | X range, px, increasing finger influence toward image-right. |
| `hand.fingerYBand` | Y range, px, fading finger influence toward bottom. |
| `hand.pinBand` | Y range, px, increasing lower arm anchoring toward image bottom. |
| `mesh.baseCell` | Coarse base-layer cell spacing, px; example `14`. |
| `mesh.fine.x0` | Face/hair refinement rectangle left x, px; enclose moving features. |
| `mesh.fine.x1` | Refinement rectangle right x, px; greater than x0. |
| `mesh.fine.y0` | Refinement rectangle top y, px; above crown/hair. |
| `mesh.fine.y1` | Refinement rectangle bottom y, px; below chin/hair tips. |
| `mesh.fine.cell` | Fine base-layer cell spacing, px; example `7`, reduce only when detail needs it. |
| `mesh.handCell` | Hand-layer cell spacing, px; example `9`. |
| `mesh.tasselCell` | Hanging-accessory cell spacing, px; example `6`. |
| `mesh.eyeBallCell` | Eye white/iris layer cell spacing, px; example `4`. |
| `mesh.eyeCell` | Lash/lid layer cell spacing, px; example `3`. |
| `mesh.spriteCell` | Drawn eye/mouth sprite cell spacing, px; example `4`. |
| `view.padTop` | Top viewport margin as fraction of source height; negative crops crown, must be between -1 and 1. |
| `view.padSide` | Each side viewport margin as fraction of source width; start at `0`, must exceed -0.5. |
| `view.gazeCenter` | Optional pointer-follow origin `[x,y]`, px; between eyes; defaults to head centre. |

Draft validation accepts omitted `x0/x1/top/bot` only as a complete group; supplying some of
the four fields is an error. Complete rigs always require all four. Changing eye geometry
requires rebuilding; old sampled curves cannot reconstruct new image pixels.

## Optional garments

Experimental full-body feature; its fields and behaviour may change.

`cloth` is an optional array. Omit it or use `[]` to retain the existing rendering.
Coordinates are source-image pixels, with x increasing right and y increasing down.

| Field | Meaning / default |
| --- | --- |
| `cloth[*].name` | Unique letters/digits/underscore/hyphen name; generates `cloth_<name>.png`. |
| `cloth[*].outline` | Cutout polygon, at least three points, enclosing all ruffles and tails belonging to this garment. Changing it requires rebuilding layers. |
| `cloth[*].waist` | Upper attachment polyline, at least two points, from image-left to right. Follows the body or parent garment. |
| `cloth[*].hem` | Lower polyline, at least two points, from image-left to right. Cover the full width of the cloth, including projecting ruffles. |
| `cloth[*].seams` | Optional waist-to-hem column polylines, ordered image-left to right; empty uses the waist/hem grid. Supply 2–64 lines with at least two points each and strictly increasing y. Nonempty seams override `columns`; lengths follow the source polylines. |
| `cloth[*].tiers` | Optional array of 0–8 cross-column joint polylines, ordered waist to hem. Each line has at least two points and crosses every column exactly once. With N tiers there are N+1 coupled links; empty uses two links split at half the source length. |
| `cloth[*].scale` | Optional positive image scale, millimetres per source pixel. If omitted, infer 0.8m from mean hip-to-ankle length when `legs` exists; otherwise assume image height represents 1.6m. Supply this for cropped or unusually proportioned art. |
| `cloth[*].columns`, `rows` | Integer grid node counts, both at least `2`; defaults `8`, `5`. With seams/tiers, `rows` is a minimum: the grid includes every tier joint and at least two subdivisions per link. |
| `cloth[*].responseGain` | Positive rendered-response exaggeration; default `1` (physical). `1.6` amplifies cloth angles only. Child solvers use the unexaggerated parent grid, while visible attachments follow the exaggerated grid. |
| `cloth[*].tierGain` | Positive render-only multiplier on each link's angle relative to the uppermost link; default `1`. Applies only when seams or tiers are nonempty. Changes visible bending without changing physical states, frequencies or child solver input. |
| `cloth[*].highModeDamping` | Positive damping-ratio multiplier for modes above the lowest-frequency mode; default `1`. Applies only when seams or tiers are nonempty. Below `1` lets higher modes oscillate longer; the lowest mode keeps `0.25 × damping`. |
| `cloth[*].swing` | Positive multiplier on the physical pendulum frequency; default `1`. A value of `1` uses the source scale, column length and gravity. |
| `cloth[*].stiffness` | Positive restoring-force multiplier; default `1`. Modal frequencies scale by `swing × √stiffness`, using effective link lengths of `0.8` times their source lengths. |
| `cloth[*].damping` | Positive damping multiplier; default `1`. Base small-angle damping ratio is `0.25 × damping`; larger values suppress oscillations. `highModeDamping` can further scale higher modes in the seams/tiers solver. |
| `cloth[*].follow` | Column rigidity, `0..1`; default `0.85`. At `1` each link is rigid; lower values add up to 10% within-link quadratic bend, without a delayed row chain. |
| `cloth[*].cohesion` | Integer smoothing passes over column angles and angular velocities, `0..8`; default `3`. |
| `cloth[*].wind` | Nonnegative coherent breeze strength as a fraction of `max`; default `0.05`, `0` disables wind. All columns receive the same phase. |
| `cloth[*].max` | Positive soft limit on grid displacement from the body-carried shape, px; default `20`. Limits rotation at the hem and reserves up to 10% for weak vertical bounce. Extrapolated mesh points outside the grid can move farther. |
| `cloth[*].behind` | Optional boolean, default `false`; draw before the bare base when true. Changing depth requires rebuilding overlapping cutouts. |
| `cloth[*].parent` | Optional name of an **earlier** cloth entry. Its displaced grid drives this garment's waist, useful for rear tails attached to a skirt. |
| `body.hip.shift` | Optional full-body sideways travel at `bodyAngleX=10`, px. Supply with `band` to fade sideways motion toward planted feet. |
| `body.hip.band` | Increasing source-y range over which sideways body travel fades to zero. Existing rigs without `hip` keep their original deformation. |
| `mesh.clothCell` | Positive integer garment render-mesh spacing, px; default `8`. Independent of cloth grid node counts. |

Without seams or tiers, each column retains its existing two equal-length pendulum
links. Nonempty seams or tiers use an N-link serial pendulum, with link lengths
measured along each source column between tier intersections. Without explicit
seams, columns interpolate the waist and hem. Validation rejects crossed or inverted
grid cells, columns shorter than 1 source pixel, missing or repeated tier crossings,
and tier intersections that are not ordered waist to hem. Adjacent intersections,
including the endpoints, must be separated by at least 0.001 of the column length.

Columns are driven by the attachment's horizontal acceleration, including motion
from pelvis yaw. Gravity is 9.80665m/s², converted to source pixels.
Each link uses an effective length of 0.8 times its source length, between a uniform rigid strip
(2L/3) and a tip-heavy point mass (L), approximating a ruffled hem.
Upward attachment acceleration increases apparent gravity; source y points down,
so the implementation uses `g - accelerationY`. The angle is relative to the world
rest shape, so the cloth retains its hanging orientation as the pelvis tilts.
Absolute link angles are solved together using the pendulum mass matrix, gravity
and Coriolis forces, with endpoint masses proportional to link lengths. The legacy
equal-length two-link solver uses Rayleigh damping for both small-angle modes.
The seams/tiers solver uses modal damping to set every small-angle mode to
`0.25 × damping`, with `highModeDamping` applied above the lowest mode. Frequencies
follow link lengths rather than hand-tuned rows. Each rendered link retains its
length, with a small within-link bend controlled by `follow`.
Each link endpoint retains its distance from that link's pivot; a separate weak, critically damped vertical response can change it slightly during vertical acceleration. Parent
accelerations are evaluated on the parent's unexaggerated physical grid; visible attachments follow its rendered grid. No additional
random samples are used.

`setClothTuning(name, tuning)` accepts a `Partial<ClothTuning>` containing the
tuning fields above. A `null` name applies to all garments; a string applies only to
that name. Updates take effect on the next simulation step without resetting velocity,
changing the rig or rebuilding layers. Invalid values or an unknown name throw a
`RangeError`. Studio edits update the rig and are included when saving it.
In Studio's **Cloth** inspector, add or delete seam and tier lines, drag their
vertices, double-click edges to add vertices, or Alt-click vertices to remove them.
These motion-grid edits do not require rebuilding image layers; outline edits do.
The element exposes this method through `element.avatar` / `await element.ready`;
React exposes the same element through its ref and the runtime through `onLoad`.

## Optional planted legs

Experimental full-body feature; its fields and behaviour may change.

Omit `legs` to retain the existing deformation exactly. `weightShift` is an optional
parameter in `-1..1`, default `0`: negative supports the image-left leg, positive
supports the image-right leg. For rigs with `legs`, idle weight transfer uses a five-second cycle: a 0.9-second quintic S transition and 1.6-second hold in each half-cycle, targeting `±0.7`. The existing body spring smooths it. Rigs without `legs` retain the previous deterministic sine and deformation.

| Field | Meaning |
| --- | --- |
| `legs.spine` | Optional stabilization fraction `0..1`, default `0.7`; the upper torso retains a small opposite pelvic inclination of `1 - spine`, blended through the spine. Chest and head follow serial springs rather than a rigid translating trunk. |
| `legs.bob` | Optional nonnegative extra pelvis dip in source px, default `2`; driven by transfer speed and returning to zero during a hold. Included in the planted-foot IK. |
| `legs.twist` | Optional pelvis yaw limit in degrees, `0..15`; absent or `0` preserves the existing output. Weight transfer drives yaw, with a small residual during holds. Shoulders partly counterturn according to `spine`, the head stays frontal, and feet stay fixed. |
| `legs.pelvis` | Bone rotation centre `[x,y]` in source pixels. |
| `legs.shift` | Nonnegative sideways travel in px at full weight transfer. |
| `legs.tilt` | Nonnegative pelvic tilt in radians at full transfer; the free side lowers. |
| `legs.bend` | Nonnegative inward-flexion scale in px. The free knee gets an extra inward offset of `bend * weightShift²`; the remaining flexion goes towards the camera. Also sets the small soft-IK settling scale. |
| `legs.band` | Increasing source-y interval for counter-rotation; the spine blends towards the chest; shoulder inclination is partly countered rather than fully cancelled. |
| `legs.left`, `legs.right` | Image-side joints, each with `hip`, `knee`, `ankle` source points. Require band start < hip y < knee y < ankle y. The rest knee determines which way the leg bends. |
| `legs.split` | Polyline dividing the legs, with strictly increasing y. Put its start inside the crotch gap: the split is hard below this point and blends over eight pixels above it. |

The IK is solved in 3D, with a forward pole, then projected onto the drawing. Bone
lengths are preserved in 3D; the projected bones may shorten. The source knee's
inward offset relative to the hip–ankle axis travels with that axis, retaining the
drawn rest shape. Rest forward depth is 5% of the shorter projected bone. A smooth
pelvis drop keeps both legs within reach without sudden knee extension; calibrate
modest shift/tilt values for each illustration. At neutral, the added deformation is zero.
With legs, `bodyAngleX` enters the same pelvis/IK transform, using `body.hip.shift`
when supplied, and does not also apply the legacy hip shear. Breath and body roll
remain in their existing order, fading to zero over the last 55 px before the ankles.
Vertices at and below the higher ankle stay exactly fixed. Cloth attachments follow
the pelvis through the usual base deformer, with their existing lag.

Studio exposes the pelvis and joint handles, an editable split polyline, and the
shift, tilt, bend, band and optional twist fields under **Legs**. These edits
recalculate weights without marking image layers stale. Pause idle motion to test the **Weight shift**
slider, then save the rig to persist the geometry and tuning.

`render-poses` adds `weight-left`, `weight-right` at `±0.6`, plus
`weight-shift-0..9` over one five-second cycle when `legs` is present.

For planted rigs, the chest drive lags the pelvis by approximately 0.1–0.2s; head stabilization follows one spring later and preserves intentional head gestures. Independent idle body noise is reduced to 35% without changing random-number consumption.


## Optional hanging arms

Experimental full-body feature; its fields and behaviour may change.

Use `arms` for front-facing, hanging arms separated from the body by a transparent gap.
Omit it for arms touching or in front of the torso, hands on hips, crossed arms, and
bust-up illustrations. This is a small deformation of the original drawing; it does
not reconstruct hidden skin or clothing, raise the arms, or resolve cloth collisions.
Without `arms`, the avatar keeps its existing deformation. The native runtime currently
ignores `arms` and its parameters; use the WebGL runtime for this feature.

| Field | Meaning |
| --- | --- |
| `arms.left`, `arms.right` | Image-left and image-right arms. Each has the source-pixel points `shoulder`, `elbow`, `wrist` and its own `split` polyline. All points must be inside the image, with shoulder y < elbow y < wrist y. |
| `arms.left.shoulder`, `arms.right.shoulder` | Upper-arm pivot `[x,y]`, inside the sleeve near the armpit. Motion fades to zero at the shoulder to keep the sleeve attached. |
| `arms.left.elbow`, `arms.right.elbow` | Elbow pivot `[x,y]`. Upper arm and forearm motion blend around this joint. |
| `arms.left.wrist`, `arms.right.wrist` | Wrist `[x,y]`; the hand follows the forearm. |
| `arms.left.split`, `arms.right.split` | At least two source points with strictly increasing y, tracing the transparent gap from just below the armpit to below the fingertips. The left split must be to the right of its elbow and wrist; the right split must be to their left. With cloth cutouts, check the actual `base_cloth.png` gap too. Keep the line clear of visible arm pixels and allow room for mesh cells around narrow gaps. |
| `arms.swing` | Optional upper-arm rotation limit in degrees, `0..10`, default `4`. |
| `arms.bend` | Optional additional elbow flexion limit in degrees, `0..12`, default `6`. Negative flexion is not allowed. |
| `arms.inward` | Optional `0..1` fraction of the swing limit allowed towards the body, default `0.4`. |

New parameters, all defaulting to `0`, are `armSwingL` / `armSwingR` (`-1..1`, positive
outwards) and `elbowBendL` / `elbowBendR` (`0..1`). L/R refer to the image sides. The
existing `armAngle` / `handAngle` parameters still control the separate chin-hand rig.
Zero arm parameters add exactly zero deformation. During idle, arms partly counter the
torso inclination with a damped delay and a small breathing motion.

In Studio, **Body → Arms** exposes both joint chains, editable split lines and tuning.
Joint, split and tuning edits recalculate weights without rebuilding image layers.
The four arm pose sliders appear only when `arms` is set. **Full-body support** lists
Legs / Arms / Cloth as set or not set; parts not set keep the standard motion.

Live shows which body parts the loaded avatar supports. **Track body movement** follows
visible elbows and wrists relative to the calibrated posture. Mirror swaps their image
sides. Each hidden elbow releases that side, while a hidden wrist releases only elbow
bend: hold the last pose for 500 ms, then fade to idle with a 200 ms time constant.
A 90-degree extra elbow bend maps to about `0.6` at normal sensitivity, with a camera
tracking cap of `0.75`. Tracking uses image-plane angles, so depth-only movement may
not produce the same response. Calibrate with relaxed, visible arms.

`render-poses` adds `arms-out`, `arms-in`, `elbows-bent`, `arm-left`, `arm-right`,
`arms-body-left`, `arms-body-right`, `arm-cycle-0..9` and `arm-idle-0..10` when `arms`
is present. Inspect sleeves, elbows, wrists and skirt edges in every frame. Reduce
`swing`, `bend` or `inward` if the hand enters clothing; segmentation remnants in
cut-out cloth must be corrected in the artwork rather than by increasing motion.
