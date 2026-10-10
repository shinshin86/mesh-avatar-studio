import { expect, test } from 'vitest';
import { Motion } from '../packages/runtime/src/engine/motion.js';
import { kanaToMoras, sampleMoras, skippedKanaCharacters } from '../packages/runtime/src/engine/kana.js';

test('held vowels share speech smoothing, preserve the preceding form for ん, and release', () => {
  const motion = new Motion([0, 0]); motion.mode = 'manual';
  const shapes = [];
  for (const vowel of ['a', 'i', 'o']) {
    motion.holdMouth(vowel);
    for (let i = 0; i < 30; i++) motion.update(1 / 60);
    shapes.push(motion.getLipSyncState());
  }
  expect(new Set(shapes.map(shape => `${shape.open.toFixed(2)},${shape.form}`)).size).toBe(3);
  motion.holdMouth('n'); for (let i = 0; i < 30; i++) motion.update(1 / 60);
  expect(motion.P.mouthOpen).toBeLessThan(0.001); expect(motion.P.mouthForm).toBe(0.6);
  motion.stopLipSync(); motion.update(1 / 60); expect(motion.getLipSyncState().active).toBe(false);
});

test('kana playback uses requested speed, loops, stops, and ignores unsupported text', () => {
  expect(kanaToMoras('アイ ウエオ').map(m => m.vowel)).toEqual(['a', 'i', 'n', 'u', 'e', 'o']);
  expect(skippedKanaCharacters('あA漢字いA')).toEqual(['A', '漢', '字']);
  const timeline = kanaToMoras('あいお', 1 / 4);
  expect(sampleMoras(timeline, 0.3)?.vowel).toBe('i');
  const motion = new Motion([0, 0]); motion.mode = 'manual';
  motion.speakKana('あいお', { speed: 4, loop: true });
  for (let i = 0; i < 120; i++) motion.update(1 / 60);
  expect(motion.getLipSyncState().active).toBe(true);
  motion.stopLipSync(); expect(motion.getLipSyncState().active).toBe(false);
  motion.speakKana('あ', { speed: 12 });
  for (let i = 0; i < 10; i++) motion.update(1 / 60);
  expect(motion.getLipSyncState().active).toBe(false);
  motion.speakKana('漢字', { loop: true }); expect(motion.getLipSyncState().active).toBe(false);
});

test('mora rules: youon merges, long vowels extend, sokuon inserts a short closure, bilabials close the lips', () => {
  // small ya/yu/yo rewrite the preceding mora's vowel but keep its consonant onset
  const youon = kanaToMoras('きゃしゅちょ');
  expect(youon.map(m => m.vowel)).toEqual(['a', 'u', 'o']);
  expect(youon.map(m => m.onset)).toEqual(['consonant', 'consonant', 'consonant']);
  // a leading small kana with nothing to attach to is dropped
  expect(kanaToMoras('ゃあ').map(m => m.vowel)).toEqual(['a']);

  // 'ー' lengthens the previous mora instead of adding one; a leading 'ー' is ignored
  const chouon = kanaToMoras('かーー', 0.1);
  expect(chouon).toHaveLength(1);
  expect(chouon[0].vowel).toBe('a');
  expect(chouon[0].dur).toBeCloseTo(0.3);
  expect(kanaToMoras('ーあ').map(m => m.vowel)).toEqual(['a']);
  // the lengthened mora keeps the mouth on its vowel past a single mora
  expect(sampleMoras(kanaToMoras('かー'), 0.2)?.vowel).toBe('a');
  expect(sampleMoras(kanaToMoras('かき'), 0.2)?.vowel).toBe('i');

  // 'っ' inserts a short closed mora between the surrounding sounds
  const sokuon = kanaToMoras('あっち', 0.1);
  expect(sokuon.map(m => m.vowel)).toEqual(['a', 'n', 'i']);
  expect(sokuon[1].onset).toBeNull();
  expect(sokuon[1].dur).toBeLessThan(0.1);

  // m / b / p close the lips before the vowel
  expect(kanaToMoras('まび').map(m => m.onset)).toEqual(['lips', 'lips']);

  // sokuon, long marks, ん and small kana are all playable, so only other scripts are skipped
  expect(skippedKanaCharacters('かっぷーんきゃA')).toEqual(['A']);
});
