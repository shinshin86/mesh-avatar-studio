import type { Rig } from 'mesh-avatar';

export function layerSignature(rig: Rig) {
  return JSON.stringify({
    image: rig.image,
    head: { cx: rig.head.cx, cy: rig.head.cy, rx: rig.head.rx, ry: rig.head.ry },
    buns: rig.buns ?? {},
    body: { chest: rig.body.chest, shoulders: rig.body.shoulders },
    eyes: rig.eyes,
    face: { brow: rig.face.brow, mouth: rig.face.mouth, nose: rig.face.nose },
    strands: (rig.strands ?? []).map(part => ({ nodes: part.nodes, sigma: part.sigma, max: part.max })),
    hand: rig.hand ? {
      outline: rig.hand.outline, jaw: rig.hand.jaw,
      jawRange: rig.hand.jawRange, background: rig.hand.background,
    } : null,
    accessories: (rig.accessories ?? []).map(part => ({ name: part.name, box: part.box, color: part.color })),
  });
}
