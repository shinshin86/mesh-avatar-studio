import type { Rig } from 'mesh-avatar';
import type { PartGroup } from './i18n';
export const GROUPS: PartGroup[] = ['head', 'eyes', 'mouth', 'face', 'cheeks', 'strands', 'buns', 'accessories', 'body', 'hand', 'mesh', 'view'];
export const PART_COLORS: Record<PartGroup, string> = {
  head: '#159447', body: '#7c4dce', face: '#d72c68', eyes: '#0098a8', mouth: '#ea671a',
  cheeks: '#d05383', strands: '#ca9b00', accessories: '#cf3030', hand: '#6c55d8',
  buns: '#ba31ad', mesh: '#5a6a7c', view: '#2b69d5',
};
export const SECTIONS = [
  { key: 'faceSection', groups: ['head', 'eyes', 'mouth', 'face', 'cheeks'] },
  { key: 'hairSection', groups: ['strands', 'buns', 'accessories'] },
  { key: 'bodySection', groups: ['body', 'hand'] },
  { key: 'advanced', groups: ['mesh', 'view'] },
] as const;
export function partPresent(rig: Rig, group: PartGroup) {
  const value = rig[group];
  return !!value && (Array.isArray(value) ? value.length > 0 : typeof value !== 'object' || Object.keys(value).length > 0);
}
