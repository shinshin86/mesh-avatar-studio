// Overlay layers (built/overlays, such as glasses) shown on the Live page, relayed to stream views.
export const OVERLAYS_EVENT = 'studio:overlays';
export interface OverlaysMessage { project: string; overlays: string[] }
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_OVERLAYS = 32;

/** The valid, unique overlay names in a list, or null when the list itself is not usable. */
export function overlayNames(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > MAX_OVERLAYS || !input.every(name => typeof name === 'string' && NAME.test(name))) return null;
  return [...new Set(input as string[])];
}
export function overlaysMessage(input: unknown): OverlaysMessage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || typeof data.project !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(data.project)) return null;
  const overlays = overlayNames(data.overlays);
  return overlays ? { project: data.project, overlays } : null;
}
