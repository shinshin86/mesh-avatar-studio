import { createRef } from 'react';
import { MeshAvatar, type MeshAvatarElement, type MeshAvatarInstance, type MeshAvatarProps } from '../src/index';

const ref = createRef<MeshAvatarElement>();
const props: MeshAvatarProps = { source: new Uint8Array(), expression: 'smile', emotion: 'happy', fit: 'cover', overlays: ['glasses'] };
export const example = <MeshAvatar {...props} ref={ref} id="avatar" aria-label="Character" data-character="miko"
  onLoad={avatar => { const runtime: MeshAvatarInstance = avatar; runtime.setVoiceLevel(0.5); }}
  onError={error => { const value: unknown = error; void value; }}
  onMotion={id => { const motion: string | null = id; void motion; }} />;
ref.current?.setVoiceLevel(0.5);
// @ts-expect-error Unsupported expressions are rejected.
export const invalidExpression = <MeshAvatar expression="invalid" />;
// @ts-expect-error The ref exposes the element, not a canvas.
export const invalidRef = <MeshAvatar ref={createRef<HTMLCanvasElement>()} />;
// @ts-expect-error Overlay names are a list.
export const invalidOverlays = <MeshAvatar overlays="glasses" />;
