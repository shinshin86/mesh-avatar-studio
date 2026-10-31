'use client';

import { createElement, forwardRef, useImperativeHandle, useLayoutEffect, useRef, version, type HTMLAttributes } from 'react';
import { type MeshAvatarElement, type AvatarSource, type Emotion, type Fit, type LiveExpression, type MeshAvatar as MeshAvatarInstance } from 'mesh-avatar-element';
import 'mesh-avatar-element';

export { DEFAULT_SRC, EMOTIONS } from 'mesh-avatar-element';
export type { MeshAvatarElement, AvatarSource, Emotion, Fit, LiveExpression, ClothTuning, MeshAvatar as MeshAvatarInstance } from 'mesh-avatar-element';

export interface MeshAvatarProps extends Omit<HTMLAttributes<MeshAvatarElement>, 'onLoad' | 'onError' | 'children' | 'dangerouslySetInnerHTML'> {
  src?: string;
  source?: AvatarSource;
  expression?: LiveExpression;
  emotion?: Emotion;
  fit?: Fit;
  paused?: boolean;
  noIdle?: boolean;
  label?: string;
  /** Overlay layers to show, such as glasses; names come from the avatar's built/overlays. */
  overlays?: string[];
  onLoad?: (avatar: MeshAvatarInstance) => void;
  onError?: (error: unknown) => void;
  onMotion?: (id: string | null) => void;
}

// React 18 passes className to custom elements as a "classname" attribute; React 19 maps it to class.
const CLASS_PROP = Number(version.split('.')[0]) >= 19 ? 'className' : 'class';

/** A React interface to the <mesh-avatar> element. Set its size with CSS. */
export const MeshAvatar = forwardRef<MeshAvatarElement, MeshAvatarProps>(function MeshAvatar({
  src, source, expression, emotion, fit, paused, noIdle, label, overlays, onLoad, onError, onMotion, className, ...html
}, forwardedRef) {
  // A new array with the same names must not count as a change.
  const overlayNames = overlays?.length ? overlays.join(' ') : undefined;
  const element = useRef<MeshAvatarElement>(null);
  const callbacks = useRef({ onLoad, onError, onMotion });
  const applied = useRef<{ source?: AvatarSource; src?: string; fit?: Fit } | null>(null);

  useImperativeHandle(forwardedRef, () => element.current!, []);

  useLayoutEffect(() => { callbacks.current = { onLoad, onError, onMotion }; });
  useLayoutEffect(() => {
    const el = element.current!;
    const load = (event: Event) => callbacks.current.onLoad?.((event as CustomEvent<{ avatar: MeshAvatarInstance }>).detail.avatar);
    const error = (event: Event) => callbacks.current.onError?.((event as CustomEvent<{ error: unknown }>).detail.error);
    const motion = (event: Event) => callbacks.current.onMotion?.((event as CustomEvent<{ id: string | null }>).detail.id);
    el.addEventListener('load', load);
    el.addEventListener('error', error);
    el.addEventListener('motion', motion);
    return () => {
      el.removeEventListener('load', load);
      el.removeEventListener('error', error);
      el.removeEventListener('motion', motion);
    };
  }, []);

  useLayoutEffect(() => {
    const el = element.current!;
    const previous = applied.current;
    for (const [name, value] of Object.entries({ src, fit, expression, emotion, label, overlays: overlayNames })) {
      if (value === undefined) el.removeAttribute(name);
      else el.setAttribute(name, value);
    }
    el.toggleAttribute('paused', !!paused);
    el.toggleAttribute('no-idle', !!noIdle);
    if (source !== undefined) {
      if (!previous || source !== previous.source || src !== previous.src || fit !== previous.fit) {
        // Errors are delivered through onError as well as the element's ready promise.
        void el.load(source).catch(() => {});
      }
    } else if (previous?.source !== undefined) {
      // Changing src clears the element's imperative source, even if the URL is unchanged.
      el.removeAttribute('src');
      el.setAttribute('src', src ?? '');
      if (src === undefined) el.removeAttribute('src');
    }
    applied.current = { source, src, fit };
  }, [src, source, expression, emotion, fit, paused, noIdle, label, overlayNames]);

  return createElement('mesh-avatar', { ...html, [CLASS_PROP]: className, ref: element });
});
