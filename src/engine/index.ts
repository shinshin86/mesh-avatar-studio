import type { LightingSettings } from '../lighting/settings';
import type { Rig } from '../rig/types';
import { parseRig } from '../rig/validate';
import { createMeshAvatarImpl } from './createMeshAvatar.js';
import { OVERLAY_EXPRESSIONS } from './expression-overlay.js';

export type LiveExpression = keyof typeof OVERLAY_EXPRESSIONS;
export const LIVE_EXPRESSIONS = Object.keys(OVERLAY_EXPRESSIONS) as LiveExpression[];

export interface MeshAvatarOptions {
  rig: Rig;
  assetsBase?: string;
  assets?: Record<string, string>;
  manual?: boolean;
  padTop?: number;
  padSide?: number;
  fit?: 'contain' | 'cover';
  preserveMouthForm?: boolean;
}
export interface MeshAvatar {
  readonly motions: { id: string; label: string; idle: boolean }[];
  setLighting(settings: Partial<LightingSettings>): void;
  getLightingStats(): { normalMs: number; computedLayers: number; cachedLayers: number };
  setParameters(parameters: Record<string, number>, weight?: number): void;
  getParameters(): Record<string, number>;
  setVoiceLevel(value: number): void;
  setSpeaking(on: boolean): void;
  setEmotion(tag: string | null, options?: { playMotion?: boolean }): void;
  setExpression(name: LiveExpression): void;
  getExpression(): { name: LiveExpression; active: boolean };
  setTalkGain(gain: number): void;
  play(id: string): void;
  speakKana(text: string, options?: { speed?: number; loop?: boolean }): void;
  holdMouth(vowel: 'a' | 'i' | 'u' | 'e' | 'o' | 'n'): void;
  stopLipSync(): void;
  getLipSyncState(): { active: boolean; open: number; form: number };
  setAutoIdle(on: boolean): void;
  setAutoMotion(on: boolean): void;
  setSwayGain(gain: number): void;
  onMotion(listener: (id: string | null) => void): () => void;
  advance(seconds: number, fps?: number): void;
  advanceParameters(seconds: number): void;
  destroy(): void;
}

export async function createMeshAvatar(
  canvas: HTMLCanvasElement,
  options: MeshAvatarOptions,
): Promise<MeshAvatar> {
  return createMeshAvatarImpl(canvas, { ...options, rig: parseRig(options.rig) });
}
