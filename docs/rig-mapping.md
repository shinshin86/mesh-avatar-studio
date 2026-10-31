# Rig v1 mapping

Coordinates use source-image pixels. Rotation angles use radians. Parameter ranges and
spring/motion tuning remain engine behavior constants.

| Rig fields | Reference source |
| --- | --- |
| image | rig.js IMG |
| head | HEAD, headWeight, turnWeight |
| body | BODY, breath/roll fade bands, chest and shoulder Gaussians |
| face, buns | baseWeights Gaussians and brow/jaw bands |
| eyes.opening, eyes.roi | build_layers.py EYES |
| eyes.x0/x1/top/bot | built/layers.json eyes (24 samples, authoritative pre-cut curves) |
| mouth | rig.js MOUTH and sprites.js MOUTH_AREA |
| cheeks | rig.js CHEEKS |
| strands | rig.js STRANDS |
| accessories | rig.js TASSELS, build_layers.py search boxes and redness thresholds |
| hand | rig.js bones, FOREARM_SHARE and weight bands; build_layers.py HAND_POLY, JAW_VISIBLE, JAW_X, BG_BEHIND_HAND |
| mesh | createMeshAvatar.js layer cell sizes and fine rectangle; sprites.js sprite cell |
| view | createMeshAvatar.js padTop/padSide defaults |
| view.gazeCenter (optional) | motion.js pointer-follow origin; defaults to head center when omitted |
| view.irisTravel (optional) | createMeshAvatar.js iris offset in px at gaze ±1; defaults to 7 when omitted |

The anatomical centers used by the deformation formulas (brow, eyes and chest) also come
from the matching rig Gaussian centers. Bun spring anchors use their Gaussian centers.
Optional groups are omitted or empty; no replacement miko-qipao coordinates are supplied.

Changes to eye polygons, hand cut-out geometry and accessory boxes mark layers stale.
Pre-cut eye curves and image rectangles are preserved until the planned layer builder runs;
editing a cut-out polygon alone cannot regenerate the missing image pixels by editing coordinates alone.

Strand polylines may have two or more nodes in the editor. Physics resamples their rest
positions to four nodes so the reference four-node spring algorithm remains unchanged.
The fixture's original four-node strands are used verbatim to preserve exact regression.

The image-specific deformation constants are mapped above. Image-processing kernel sizes and
color blending/inpainting algorithms belong to the planned layer builder.
