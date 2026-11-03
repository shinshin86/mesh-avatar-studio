import { expect, test } from 'vitest';
import { ExpressionOverlay, OVERLAY_EXPRESSIONS, applyOverlay, overlayTarget } from '../packages/runtime/src/engine/expression-overlay.js';
import { mergeExpressionSettings, parseExpressionSettings } from '../packages/runtime/src/engine/expression-settings.ts';
import { createSpriteModule } from '../packages/runtime/src/engine/sprites.js';

const tracked = { angleY: 0, eyeLOpen: 1, eyeROpen: 1, eyeSmile: 0, eyeSmileL: 0, mouthOpen: 0.7, mouthForm: 0.4, browY: 0.1, browAngle: 0, blush: 0, gazeX: 0.2, gazeY: 0 };

test('neutral leaves parameters untouched and the eight live expressions are in key order', () => {
  const overlay = new ExpressionOverlay();
  expect(overlay.apply(tracked, 1 / 60)).toBe(tracked);
  expect(overlay.active).toBe(false);
  expect(Object.keys(OVERLAY_EXPRESSIONS)).toEqual(['neutral', 'smile', 'shy', 'surprise', 'halfLidded', 'angry', 'sad', 'wink']);
  for (const name of Object.keys(OVERLAY_EXPRESSIONS)) expect(overlayTarget(name)).toBeTruthy();
});

test('expressions shape the face while tracking keeps the mouth and blinks', () => {
  const smile = applyOverlay(tracked, overlayTarget('smile'));
  expect(smile.eyeROpen).toBe(0); expect(smile.eyeSmile).toBe(1); expect(smile.blush).toBeGreaterThan(0.3);
  expect(smile.mouthOpen).toBe(0.7); expect(smile.mouthForm).toBe(0.4);
  const surprise = overlayTarget('surprise');
  expect(applyOverlay({ ...tracked, eyeROpen: 0 }, surprise).eyeROpen).toBe(0);
  expect(applyOverlay(tracked, surprise).eyeROpen).toBeGreaterThan(1);
  const wink = applyOverlay(tracked, overlayTarget('wink'));
  expect(wink.eyeLOpen).toBe(0); expect(wink.eyeROpen).toBe(1);
  const sad = applyOverlay(tracked, overlayTarget('sad'));
  expect(sad.angleY).toBeLessThan(0); expect(sad.gazeY).toBeLessThan(0);
  const angry = applyOverlay(tracked, overlayTarget('angry'));
  expect(angry.browAngle).toBeGreaterThan(0.5); expect(angry.browY).toBeLessThan(tracked.browY);
  for (const value of Object.values(applyOverlay({ ...tracked, browY: 0.9, gazeX: 0.9 }, overlayTarget('shy')))) expect(Number.isFinite(value)).toBe(true);
  expect(applyOverlay({ ...tracked, browY: 0.9 }, overlayTarget('surprise')).browY).toBe(1);
});

test('switching fades in and out, then passes parameters through again', () => {
  const overlay = new ExpressionOverlay();
  overlay.set('smile');
  const first = overlay.apply(tracked, 1 / 60);
  expect(first.eyeSmile).toBeGreaterThan(0); expect(first.eyeSmile).toBeLessThan(1);
  for (let i = 0; i < 120; i++) overlay.apply(tracked, 1 / 60);
  expect(overlay.apply(tracked, 1 / 60).eyeSmile).toBeCloseTo(1, 3);
  overlay.set('neutral'); expect(overlay.active).toBe(true);
  for (let i = 0; i < 240 && overlay.active; i++) overlay.apply(tracked, 1 / 60);
  expect(overlay.active).toBe(false); expect(overlay.apply(tracked, 1 / 60)).toBe(tracked);
});

test('unknown names, including inherited object keys, fall back to neutral', () => {
  const overlay = new ExpressionOverlay();
  for (const name of ['unknown', 'toString', '__proto__', 'constructor']) { overlay.set(name); expect(overlay.name).toBe('neutral'); }
});

// Only the mouth drawing choice is used here, so the engine and rig are minimal stand-ins.
const { mouthShape } = createSpriteModule({ baseWeights: () => [], deformBase: () => undefined, MOUTH: {} } as never, { mouth: { area: {} } } as never);

test('surprise keeps its "o" mouth while its mouth is open wider than the voice', () => {
  const surprise = overlayTarget('surprise');
  expect(surprise.mouthForm).toBeGreaterThan(0.35);
  // At rest and in the quiet gaps of speech the expression's mouth is wider, so its shape is shown.
  for (const voice of [{ mouthOpen: 0, mouthForm: 0 }, { mouthOpen: 0.05, mouthForm: -0.8 }, { mouthOpen: 0.3, mouthForm: 0.1 }]) {
    const out = applyOverlay({ ...tracked, ...voice }, surprise);
    expect(out.mouthOpen).toBe(surprise.mouthOpen);
    expect(out.mouthForm).toBe(surprise.mouthForm);
    expect(mouthShape(out.mouthOpen, out.mouthForm)).toBe('o');
  }
  // Louder syllables keep the lip-sync vowel.
  for (const form of [-0.8, -0.4, 0, 0.9]) {
    const loud = applyOverlay({ ...tracked, mouthOpen: 0.85, mouthForm: form }, surprise);
    expect(loud.mouthOpen).toBe(0.85); expect(loud.mouthForm).toBe(form);
  }
});

test('expressions without an open mouth leave the mouth shape to the voice or tracking', () => {
  for (const name of Object.keys(OVERLAY_EXPRESSIONS)) {
    if (overlayTarget(name).mouthOpen > 0) continue;
    for (const voice of [{ mouthOpen: 0, mouthForm: -0.6 }, { mouthOpen: 0.7, mouthForm: 0.4 }]) {
      expect(applyOverlay({ ...tracked, ...voice }, overlayTarget(name)).mouthForm).toBe(voice.mouthForm);
    }
  }
});

test('the mouth shape fades with the expression and is released after switching back', () => {
  const overlay = new ExpressionOverlay(), idle = { ...tracked, mouthOpen: 0, mouthForm: -0.3 };
  overlay.set('surprise');
  for (let i = 0; i < 120; i++) overlay.apply(idle, 1 / 60);
  expect(overlay.apply(idle, 1 / 60).mouthForm).toBeCloseTo(overlayTarget('surprise').mouthForm, 3);
  overlay.set('neutral');
  for (let i = 0; i < 240 && overlay.active; i++) overlay.apply(idle, 1 / 60);
  expect(overlay.active).toBe(false);
  expect(overlay.apply(idle, 1 / 60).mouthForm).toBe(-0.3);
});

test('without settings every live expression keeps its built-in target', () => {
  // The built-in values, written out so a change to the defaults is caught here.
  const builtIn = { neutral: 0, smile: 0, shy: 0, surprise: 0.6, halfLidded: 0, angry: 0, sad: 0, wink: 0 };
  for (const name of Object.keys(OVERLAY_EXPRESSIONS)) {
    const target = overlayTarget(name);
    expect(target.mouthOpen).toBe(builtIn[name as keyof typeof builtIn]);
    expect(overlayTarget(name, {})).toEqual(target);
    expect(overlayTarget(name, parseExpressionSettings({}))).toEqual(target);
  }
  // A whole switching sequence produces the same output with and without an empty settings object.
  const run = (overlay: ExpressionOverlay) => {
    const trace = [];
    for (const name of [...Object.keys(OVERLAY_EXPRESSIONS), 'neutral']) {
      overlay.set(name);
      for (let i = 0; i < 20; i++) trace.push(overlay.apply({ ...tracked, mouthOpen: i % 3 ? 0.6 : 0.05 }, 1 / 60));
    }
    return trace;
  };
  expect(run(new ExpressionOverlay({}))).toEqual(run(new ExpressionOverlay()));
});

test('a per-expression opening replaces the resting mouth opening of that expression only', () => {
  const settings = parseExpressionSettings({ surprise: { mouthOpen: 0.45 }, smile: { mouthOpen: 0.3 } });
  const surprise = overlayTarget('surprise', settings);
  expect(surprise.mouthOpen).toBe(0.45);
  expect({ ...surprise, mouthOpen: 0.6 }).toEqual(overlayTarget('surprise'));
  expect(overlayTarget('smile', settings).mouthOpen).toBe(0.3);
  for (const name of ['shy', 'halfLidded', 'angry', 'sad', 'wink']) expect(overlayTarget(name, settings)).toEqual(overlayTarget(name));
  // Surprise still shows its "o" drawing at rest with the smaller opening.
  const overlay = new ExpressionOverlay(settings), idle = { ...tracked, mouthOpen: 0, mouthForm: 0 };
  overlay.set('surprise');
  for (let i = 0; i < 120; i++) overlay.apply(idle, 1 / 60);
  const settled = overlay.apply(idle, 1 / 60);
  expect(settled.mouthOpen).toBeCloseTo(0.45, 3);
  expect(mouthShape(settled.mouthOpen, settled.mouthForm)).toBe('o');
  // An opening of 0 keeps the mouth closed and leaves its shape to the voice.
  const closed = parseExpressionSettings({ surprise: { mouthOpen: 0 } });
  const quiet = applyOverlay({ ...tracked, mouthOpen: 0, mouthForm: -0.3 }, overlayTarget('surprise', closed));
  expect(quiet.mouthOpen).toBe(0); expect(quiet.mouthForm).toBe(-0.3);
  expect(mouthShape(quiet.mouthOpen, quiet.mouthForm)).toBeNull();
});

test('expression settings validate values and ignore unknown expressions and fields', () => {
  expect(parseExpressionSettings({ surprise: { mouthOpen: 0.45, extra: true }, unknown: { mouthOpen: 2 }, sad: {} }))
    .toEqual({ surprise: { mouthOpen: 0.45 }, sad: {} });
  for (const value of [-0.01, 1.01, NaN, Infinity, '0.5', null])
    expect(() => parseExpressionSettings({ surprise: { mouthOpen: value } })).toThrow('expressions.surprise.mouthOpen: expected 0–1');
  for (const input of [null, [], 'surprise', 1]) expect(() => parseExpressionSettings(input)).toThrow('expressions: expected an object');
  for (const entry of [null, [], 0.45]) expect(() => parseExpressionSettings({ surprise: entry })).toThrow('expressions.surprise: expected an object');
  // neutral leaves the parameters untouched: an entry for it is ignored and changes nothing
  const withNeutral = parseExpressionSettings({ neutral: { mouthOpen: 0.2 } });
  expect(withNeutral).toEqual({});
  expect(overlayTarget('neutral', withNeutral)).toEqual(overlayTarget('neutral'));
  expect(overlayTarget('neutral', { neutral: { mouthOpen: 0.2 } } as never)).toEqual(overlayTarget('neutral'));
  const neutralRun = (overlay: ExpressionOverlay) => { overlay.set('neutral'); return overlay.apply({ ...tracked }, 1 / 60); };
  expect(neutralRun(new ExpressionOverlay(withNeutral))).toEqual({ ...tracked });
  for (const name of ['toString', '__proto__', 'constructor'])
    expect(parseExpressionSettings(JSON.parse(`{"${name}": {"mouthOpen": 0.5}}`))).toEqual({});
  expect(mergeExpressionSettings({ surprise: { mouthOpen: 0.45 }, smile: { mouthOpen: 0.2 } }, { surprise: { mouthOpen: 0.3 }, sad: {} }))
    .toEqual({ surprise: { mouthOpen: 0.3 }, smile: { mouthOpen: 0.2 }, sad: {} });
});
