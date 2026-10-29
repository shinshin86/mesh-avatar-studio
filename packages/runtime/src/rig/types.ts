export type Point = [number, number];
export type Band = [number, number];
export interface Ellipse { cx: number; cy: number; rx: number; ry: number }
export interface Eye {
  opening: Point[];
  roi: Point[];
  x0: number;
  x1: number;
  top: number[];
  bot: number[];
}
export interface Strand {
  name: string;
  nodes: Point[];
  sigma: number;
  k: number;
  max: number;
}
export interface Accessory {
  name: string;
  pivot: Point;
  tip: Point;
  split: number;
  box: [number, number, number, number];
  color: { redness: number; minRed: number };
}
/** Optional garment that swings with the body (for example a skirt). */
export interface ClothTuning {
  responseGain?: number;
  swing: number;
  stiffness: number;
  damping: number;
  follow: number;
  cohesion: number;
  wind: number;
  max: number;
}
export interface Cloth extends Partial<ClothTuning> {
  /** Physical image scale in millimetres per source pixel; inferred if omitted. */
  scale?: number;
  name: string;
  outline: Point[];
  waist: Point[];
  hem: Point[];
  columns?: number;
  rows?: number;
  behind?: boolean;
  parent?: string;
}
export interface Hand {
  outline: Point[];
  jaw: Point[];
  jawRange: Band;
  background: Point[];
  elbow: Point;
  wrist: Point;
  knuckle: Point;
  contact: Point;
  forearmShare: number;
  armBand: Band;
  wristBand: Band;
  handBand: Band;
  fingerXBand: Band;
  fingerYBand: Band;
  pinBand: Band;
}
export interface Leg { hip: Point; knee: Point; ankle: Point }
/** Optional planted-foot weight transfer. Left/right refer to the image. */
export interface Legs {
  spine?: number;
  bob?: number;
  pelvis: Point;
  shift: number;
  tilt: number;
  bend: number;
  band: Band;
  left: Leg;
  right: Leg;
  split: Point[];
}
export interface Rig {
  version: 1;
  image: { width: number; height: number };
  head: Ellipse & {
    shiftX: number; shiftY: number; pivotX: number; pivotY: number;
    maxRoll: number; weightBand: Band; turnBand: Band;
  };
  body: {
    pivotX: number; pivotY: number; maxRoll: number;
    breathBand: Band; rollBand: Band; chest: Ellipse; shoulders: Ellipse[];
    hip?: { shift: number; band: Band };
  };
  face: Record<'nose' | 'mouth' | 'eyeA' | 'eyeB' | 'earL' | 'earR', Ellipse> & {
    brow: Ellipse & { band: Band };
    jaw: Ellipse & { band: Band };
  };
  buns?: Partial<Record<'bunL' | 'bunR', Ellipse>>;
  eyes: Eye[];
  mouth: {
    cx: number; cy: number; angle: number; halfLen: number; bow: number;
    area: Ellipse & { angle: number };
  };
  cheeks: Point[];
  strands?: Strand[];
  accessories?: Accessory[];
  hand?: Hand;
  cloth?: Cloth[];
  legs?: Legs;
  mesh: {
    baseCell: number;
    fine: { x0: number; x1: number; y0: number; y1: number; cell: number };
    handCell: number; tasselCell: number; eyeBallCell: number;
    eyeCell: number; spriteCell: number; clothCell?: number;
  };
  view: { padTop: number; padSide: number; gazeCenter?: Point };
}
