// Source-pixel joints based on the leg/arm unit-test fixtures; sample assets stay unchanged.
export function limbRig(source, variant = 'legs-arms') {
  const rig = structuredClone(source);
  if (variant !== 'arms' && variant !== 'hip') rig.legs = {
    pelvis: [627, 900], band: [700, 940], shift: 12, tilt: 0.04, bend: 4,
    left: { hip: [570, 930], knee: [560, 1080], ankle: [550, 1210] },
    right: { hip: [680, 930], knee: [690, 1080], ankle: [700, 1210] },
    split: [[627, 950], [627, 1250]],
    ...(variant === 'twist' ? { twist: 8, spine: 0.6, bob: 3 } : {}),
  };
  if (variant !== 'legs' && variant !== 'hip') rig.arms = {
    left: { shoulder: [250, 650], elbow: [200, 800], wrist: [150, 950], split: [[265, 680], [235, 800], [200, 1030]] },
    right: { shoulder: [1004, 650], elbow: [1054, 800], wrist: [1104, 950], split: [[989, 680], [1019, 800], [1054, 1030]] },
  };
  if (variant === 'hip' || variant === 'twist') rig.body.hip = { shift: 9, band: [900, 1210] };
  return rig;
}
