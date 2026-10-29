import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, PARAMS } from 'mesh-avatar';
import { createRig } from '../packages/runtime/src/engine/rig.js';
import { createSpriteModule, eyeMood } from '../packages/runtime/src/engine/sprites.js';

const rig = parseRig(fixture);
const engine = createRig(rig);
const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const physics = { strands: [], bunL: [0, 0], bunR: [0, 0] };

// Minimal renderer: records each sprite layer so the visible drawings can be read back.
function sprites(names: string[]) {
  const layers = new Map<string, { visible: boolean; alpha: number }>();
  const renderer = { addLayer(name: string) { const layer = { visible: false, alpha: 1 }; layers.set(name, layer); return layer; } };
  const sheet = { build: 'test', layers: Object.fromEntries(names.map(name => [name, [500, 400, 10, 10]])) };
  const images = Object.fromEntries(names.map(name => [name, { width: 10 }]));
  const grid = (rect: number[]) => ({ rest: [rect[0], rect[1]], pos: [0, 0] });
  type Create = (...args: unknown[]) => { eyesDrawn: boolean[]; update(P: Record<string, number>, phys: unknown, dt: number, mood?: string | null): { eyes: boolean[]; mouthDrawn: boolean } };
  const update = (createSpriteModule(engine, rig).createSprites as unknown as Create)(renderer, sheet, images, grid, () => new Uint8Array(1));
  let mouthDrawn = false;
  const frame = (open: number, mood: string | null = null, dt = 1, mouthOpen = 0, smile = 0, mouthForm = 0) => {
    const result = update.update({ ...defaults, eyeROpen: open, eyeLOpen: open, eyeSmile: smile, eyeSmileL: smile, mouthOpen, mouthForm }, physics, dt, mood);
    mouthDrawn = result.mouthDrawn;
    return { covered: result.eyes, shown: [...layers].filter(([, layer]) => layer.visible && layer.alpha > 0).map(([name]) => name).sort() };
  };
  return Object.assign(frame, { eyesDrawn: update.eyesDrawn, mouthDrawn: () => mouthDrawn });
}

const eyes = (...kinds: string[]) => kinds.flatMap(kind => [`eyes_${kind}_0`, `eyes_${kind}_1`]);

test('expression names map to drawn-eye moods, and the live expression wins over the motion one', () => {
  expect(eyeMood('angry', null)).toBe('angry');
  expect(eyeMood('neutral', 'sadTalk')).toBe('sad');
  expect(eyeMood('neutral', 'surprisedTalk')).toBe('surprise');
  expect(eyeMood('neutral', 'surprise')).toBe('surprise');
  expect(eyeMood('smile', 'angryTalk')).toBeNull();
  expect(eyeMood('neutral', 'happyTalk')).toBeNull();
  expect(eyeMood('neutral', null)).toBeNull();
});

test('drawn expression eyes replace open and half eyes, and blinks still close them', () => {
  const frame = sprites(eyes('closed', 'half', 'smile', 'angry', 'sad', 'surprise'));
  expect(frame(0.72, 'sad')).toEqual({ covered: [true, true], shown: eyes('sad') });
  // the angry face keeps the half-closed eye, even if angry eyes were drawn
  expect(frame(0.72, 'angry').shown).toEqual(eyes('half'));
  expect(frame(1.22, 'surprise')).toEqual({ covered: [true, true], shown: eyes('surprise') });
  expect(frame(0.1, 'surprise')).toEqual({ covered: [true, true], shown: eyes('closed') });
  expect(frame(0.78, 'sad').shown).toEqual(eyes('sad'));
  // Back to neutral: the plain open eye returns (no sprite drawn).
  expect(frame(1, null)).toEqual({ covered: [false, false], shown: [] });
});

test('the blink fade keeps one drawing solid underneath, so no eye turns see-through', () => {
  const frame = sprites(eyes('closed', 'half', 'sad'));
  frame(0.78, 'sad');
  // Mid-fade both drawings are shown and the layered eye stays hidden underneath.
  expect(frame(0.1, 'sad', 0.02)).toEqual({ covered: [false, false], shown: eyes('closed', 'sad').sort() });
  frame(0.1, 'sad', 1);
  expect(frame(0.78, 'sad', 0.02).shown).toEqual(eyes('closed', 'sad').sort());
  expect(frame(0.78, 'sad', 1).shown).toEqual(eyes('sad'));
});

test('avatars without drawn expression eyes keep the previous drawings', () => {
  const frame = sprites(eyes('closed', 'half', 'smile'));
  expect(frame(0.72, 'angry').shown).toEqual(eyes('half'));
  expect(frame(1.22, 'surprise')).toEqual({ covered: [false, false], shown: [] });
  expect(frame(0.1, 'sad').shown).toEqual(eyes('closed'));
});

test('drawn expression mouths replace the closed mouth until an open mouth drawing has faded in', () => {
  const frame = sprites(['mouth_a', 'mouth_a_half', 'mouth_angry', 'mouth_sad']);
  expect(frame(1, 'angry').shown).toEqual(['mouth_angry']);
  expect(frame(1, 'sad').shown).toEqual(['mouth_sad']);
  expect(frame(1, 'surprise').shown).toEqual([]);
  // fading in, the open mouth is drawn over the solid closed one; then it is shown alone
  expect(frame(1, 'angry', 1, 0.18).shown).toEqual(['mouth_a_half', 'mouth_angry']);
  expect(frame(1, 'angry', 1, 0.5).shown).toEqual(['mouth_a_half']);
  expect(frame(1, null).shown).toEqual([]);
});

test('without open mouth drawings the expression mouth stays while speaking', () => {
  const frame = sprites(['mouth_sad']);
  expect(frame(1, 'sad', 1, 0.5).shown).toEqual(['mouth_sad']);
  expect(frame(1, 'angry', 1, 0).shown).toEqual([]);
});

test('a partial set leaves missing eye drawings to the layered eye instead of hiding it', () => {
  const frame = sprites(eyes('closed'));
  // without the half-closed drawing the layered eye keeps animating its own openness
  expect(frame.eyesDrawn).toEqual([false, false]);
  expect(frame(0.5)).toEqual({ covered: [false, false], shown: [] });
  expect(frame(0.1)).toEqual({ covered: [true, true], shown: eyes('closed') });
  // a smiling blink without the smiling drawing uses the closed one
  expect(frame(0.1, null, 1, 0, 1)).toEqual({ covered: [true, true], shown: eyes('closed') });
  expect(frame(0.5, 'angry')).toEqual({ covered: [false, false], shown: [] });
  expect(sprites(eyes('closed', 'half')).eyesDrawn).toEqual([true, true]);
});

test('the shader mouth is turned off only while a drawing shows the mouth', () => {
  const eyesOnly = sprites(eyes('closed', 'half'));
  eyesOnly(1, null, 1, 0.8);
  expect(eyesOnly.mouthDrawn()).toBe(false);
  const some = sprites(['mouth_a']);
  some(1, null, 1, 0);
  expect(some.mouthDrawn()).toBe(true);
  expect(some(1, null, 1, 0.8).shown).toEqual(['mouth_a']);
  expect(some.mouthDrawn()).toBe(true);
  // the い shape has no drawing here, so the shader mouth shows it
  expect(some(1, null, 1, 0.5, 0, -1).shown).toEqual([]);
  expect(some.mouthDrawn()).toBe(false);
  const full = sprites(['mouth_a', 'mouth_a_half', 'mouth_i', 'mouth_o']);
  for (const [open, form] of [[0, 0], [0.3, 0], [0.8, 0], [0.5, -1], [0.6, 1]]) {
    full(1, null, 1, open, 0, form);
    expect(full.mouthDrawn()).toBe(true);
  }
});
