import { expect, test } from 'vitest';
import { ExpressionOverlay, OVERLAY_EXPRESSIONS, applyOverlay, overlayTarget } from '../src/engine/expression-overlay.js';

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
