import { describe, expect, it } from 'vitest';
import { frameSeconds, parseEmotion, parseExpression, parseFit, parseOverlays, ReadySignal } from '../src/attributes';

describe('attribute parsing', () => {
  it('reads expressions, treating a missing attribute as neutral', () => {
    expect(parseExpression(null)).toBe('neutral');
    expect(parseExpression('')).toBe('neutral');
    expect(parseExpression('smile')).toBe('smile');
    expect(parseExpression('halfLidded')).toBe('halfLidded');
    expect(parseExpression('grin')).toBeUndefined();
  });

  it('reads emotions, treating a missing attribute as none', () => {
    expect(parseEmotion(null)).toBeNull();
    expect(parseEmotion('happy')).toBe('happy');
    expect(parseEmotion('Happy')).toBeUndefined();
  });

  it('reads fit, defaulting to contain', () => {
    expect(parseFit(null)).toBe('contain');
    expect(parseFit('cover')).toBe('cover');
    expect(parseFit('fill')).toBeUndefined();
  });

  it('limits frame steps like the runtime loop', () => {
    expect(frameSeconds(1016, 1000)).toBeCloseTo(0.016);
    expect(frameSeconds(5000, 1000)).toBe(0.05);
    expect(frameSeconds(1000, 1000)).toBe(0.001);
  });
});

describe('overlay names', () => {
  it('come from a space-separated attribute', () => {
    expect(parseOverlays(null)).toEqual([]);
    expect(parseOverlays('')).toEqual([]);
    expect(parseOverlays('glasses')).toEqual(['glasses']);
    expect(parseOverlays('  glasses   hat ')).toEqual(['glasses', 'hat']);
  });
});

describe('ReadySignal', () => {
  it('keeps one pending promise across loads that start before the previous one finishes', async () => {
    const ready = new ReadySignal<string>();
    ready.start();
    const first = ready.promise;
    ready.start();
    expect(ready.promise).toBe(first);
    ready.resolve('second avatar');
    await expect(first).resolves.toBe('second avatar');
  });

  it('starts a new promise after the previous one settled', async () => {
    const ready = new ReadySignal<string>();
    ready.start();
    ready.resolve('first');
    const first = ready.promise;
    ready.start();
    expect(ready.promise).not.toBe(first);
    ready.reject(new Error('broken file'));
    await expect(ready.promise).rejects.toThrow('broken file');
  });

  it('does not report a rejection nobody awaited', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    const ready = new ReadySignal<string>();
    ready.start();
    ready.reject(new Error('ignored'));
    await new Promise(resolve => setTimeout(resolve, 0));
    process.off('unhandledRejection', listener);
    expect(unhandled).toEqual([]);
  });
});
