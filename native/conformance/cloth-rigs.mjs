import { limbRig } from './limb-rigs.mjs';

export function clothRig(source, variant = 'custom') {
  const rig = variant === 'legs' ? limbRig(source, 'twist') : structuredClone(source);
  const skirt = { name: 'skirt', outline: [[450, 880], [750, 880], [790, 1100], [410, 1100]],
    waist: [[450, 880], [600, 885], [750, 880]], hem: [[410, 1100], [600, 1120], [790, 1100]],
    columns: 4, rows: 6, wind: 0.3, max: 35, responseGain: 1.6, follow: 0.95 };
  if (['custom', 'seams', 'legs'].includes(variant)) skirt.seams = [
    [[450, 880], [420, 990], [410, 1100]], [[550, 883], [540, 1000], [530, 1110]],
    [[650, 883], [660, 1000], [670, 1110]], [[750, 880], [780, 990], [790, 1100]],
  ];
  if (['custom', 'tiers', 'legs'].includes(variant)) skirt.tiers = [[[390, 940], [810, 940]], [[390, 1060], [810, 1060]]];
  if (variant === 'zero') { skirt.hem = structuredClone(skirt.waist); skirt.wind = 0; }
  const tail = { name: 'tail', behind: true, parent: 'skirt', outline: [[420, 1080], [500, 1080], [510, 1230], [430, 1230]],
    waist: [[420, 1080], [500, 1080]], hem: [[430, 1230], [510, 1230]], columns: 3, rows: 5,
    scale: 2, swing: 0.8, stiffness: 1.2, damping: 0.7, follow: 0.5, cohesion: 1, wind: 0.1, max: 28 };
  if (variant === 'custom' || variant === 'legs') tail.seams = [[[420, 1080], [425, 1150], [430, 1230]], [[500, 1080], [505, 1160], [510, 1230]]];
  rig.cloth = variant === 'empty' ? [] : variant === 'zero' ? [skirt] : [skirt, tail];
  rig.mesh.clothCell = 8;
  return rig;
}
