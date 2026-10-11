import type { Rig } from 'mesh-avatar';

type Messages = Record<'accessory' | 'jobBoxOutside' | 'jobBoxEmpty' | 'jobBoxInvalid' | 'jobAccessoryPixels' | 'jobEyeRegion' | 'jobHandRegion' | 'jobFaceRegion' | 'jobImageSize' | 'jobMeshRegion', string>;
export function jobReason(log: string, t: Messages, rig?: Rig, fieldTitle: (field: string) => string = field => field): string | undefined {
  const error = log.split('\n').filter(line => !/rounded outward/.test(line)).join('\n');
  const accessory = error.match(/accessories\[(\d+)\]\.box[^\n]*/);
  if (accessory) {
    const index = Number(accessory[1]), name = rig?.accessories?.[index]?.name;
    const part = `${t.accessory} ${index + 1}${name ? ` (${name})` : ''}`;
    const message = /integer|finite coordinates/.test(accessory[0]) ? t.jobBoxInvalid : /no area|positive width|positive area/.test(accessory[0]) ? t.jobBoxEmpty : /inside|within|outside/.test(accessory[0]) ? t.jobBoxOutside : t.jobBoxInvalid;
    return message.replace('PART', part);
  }
  const pixels = error.match(/accessory ([A-Za-z0-9_-]+): no pixels/);
  if (pixels) return t.jobAccessoryPixels.replace('PART', pixels[1]);
  const eye = error.match(/eyes\[(\d+)\]\.(opening|roi)/);
  if (eye) return t.jobEyeRegion.replace('INDEX', String(Number(eye[1]) + 1));
  if (/hand\.(outline|background|jaw|jawRange)/.test(error)) return t.jobHandRegion;
  const face = error.match(/face\.(brow|mouth|nose)/);
  if (face) return t.jobFaceRegion.replace('FIELD', fieldTitle(face[1]));
  if (/rig\.image must match/.test(error)) return t.jobImageSize;
  if (/mesh\.(fine|\w*Cell)/.test(error)) return t.jobMeshRegion;
}
