import { parameterRanges } from './tracking';

export const LIVE_EVENT = 'studio:live-params';
export interface LiveMessage { project: string; params: Record<string, number>; t: number; sender?: string }
export function liveMessage(input: unknown): LiveMessage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !['project', 'params', 't', 'sender'].includes(key)) ||
      (data.sender !== undefined && (typeof data.sender !== 'string' || !/^[a-z0-9]{8,32}$/.test(data.sender))) ||
      typeof data.project !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(data.project) ||
      typeof data.t !== 'number' || !Number.isFinite(data.t) || data.t < 0 ||
      !data.params || typeof data.params !== 'object' || Array.isArray(data.params)) return null;
  const entries = Object.entries(data.params);
  if (!entries.length || entries.length > parameterRanges.size) return null;
  const params: Record<string, number> = {};
  for (const [key, value] of entries) {
    const range = parameterRanges.get(key);
    if (!range || typeof value !== 'number' || !Number.isFinite(value)) return null;
    params[key] = Math.max(range[0], Math.min(range[1], value));
  }
  return { project: data.project, params, t: data.t, ...(typeof data.sender === 'string' ? { sender: data.sender } : {}) };
}

export class LivePose {
  private received = -Infinity;
  private params: Record<string, number> = {};
  private weight = 0;
  constructor(private project: string) {}
  private sender: string | undefined;
  receive(input: unknown, now: number) {
    const message = liveMessage(input);
    if (!message || message.project !== this.project) return false;
    // With two Live pages open for one project, follow one of them until it goes quiet;
    // alternating between their poses makes the avatar flicker.
    if (message.sender !== this.sender && now - this.received <= 1000) return false;
    this.sender = message.sender; this.params = message.params; this.received = now; return true;
  }
  sample(now: number, dt: number) {
    // Sender timestamps come from another browser clock. Use local receipt time.
    const active = now - this.received <= 1000;
    this.weight = active ? 1 : this.weight * Math.exp(-Math.max(0, dt) / 0.2);
    if (this.weight < 0.005) this.weight = 0;
    return { active, params: this.params, weight: this.weight };
  }
}
