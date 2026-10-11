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
