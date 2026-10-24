import { loadMeshAvatar, type AvatarSource, type MeshAvatar } from 'mesh-avatar';
import { DEFAULT_SRC, frameSeconds, parseEmotion, parseExpression, parseFit, ReadySignal, type Fit } from './attributes.js';

export { DEFAULT_SRC, EMOTIONS } from './attributes.js';
export type { Emotion, Fit } from './attributes.js';
export type { AvatarSource, MeshAvatar, LiveExpression, ClothTuning } from 'mesh-avatar';

const STYLE = `
:host { display: block; position: relative; aspect-ratio: 1 / 1; }
:host([hidden]) { display: none; }
canvas { display: block; width: 100%; height: 100%; }
`;

// Server-side rendering has no HTMLElement; the class is defined but never registered there.
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<mesh-avatar>`: shows a Mesh Avatar Studio avatar. Without `src` it shows the Miko sample.
 * Animation pauses while the element is off screen, the tab is hidden or `paused` is set.
 */
export class MeshAvatarElement extends Base {
  static observedAttributes = ['src', 'fit', 'expression', 'emotion', 'paused', 'no-idle', 'label'];

  #canvas: HTMLCanvasElement;
  #avatar: MeshAvatar | null = null;
  #ready = new ReadySignal<MeshAvatar>();
  #loadId = 0;
  #loading = false;
  #scheduled: object | null = null;
  #source: AvatarSource | undefined;
  #raf = 0;
  #previous = 0;
  #onScreen = true;
  #observer: IntersectionObserver | null = null;
  #voiceLevel: number | null = null;
  #warned = new Set<string>();

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.#canvas = document.createElement('canvas');
    this.#canvas.setAttribute('role', 'img');
    this.#canvas.setAttribute('aria-label', 'Avatar');
    root.append(style, this.#canvas);
    this.#ready.start();
    this.#canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.#stopLoop(); });
    this.#canvas.addEventListener('webglcontextrestored', () => this.#load());
  }

  /** The loaded runtime avatar, or null while loading. Every `mesh-avatar` method is available on it. */
  get avatar() { return this.#avatar; }
  /** Resolves with the avatar once the current source has loaded. */
  get ready() { return this.#ready.promise; }

  /** Loads a file, archive or URL without changing `src`. A changed `src` replaces this source. */
  load(source: AvatarSource): Promise<MeshAvatar> {
    this.#scheduled = null;
    this.#source = source;
    void this.#load();
    return this.ready;
  }

  get src() { return this.getAttribute('src') ?? ''; }
  set src(value: string) { this.setAttribute('src', value); }
  get fit(): Fit { return parseFit(this.getAttribute('fit')) ?? 'contain'; }
  set fit(value: Fit) { this.setAttribute('fit', value); }
  get expression() { return this.getAttribute('expression') ?? 'neutral'; }
  set expression(value: string) { this.setAttribute('expression', value); }
  get emotion() { return this.getAttribute('emotion'); }
  set emotion(value: string | null) { if (value === null) this.removeAttribute('emotion'); else this.setAttribute('emotion', value); }
  get paused() { return this.hasAttribute('paused'); }
  set paused(value: boolean) { this.toggleAttribute('paused', value); }

  /** Mouth opening from the voice loudness, 0 to 1. Kept until the avatar loads. */
  setVoiceLevel(value: number) {
    this.#voiceLevel = value;
    this.#avatar?.setVoiceLevel(value);
  }

  /** Moves the mouth to Japanese text without audio. Waits for the avatar to load. */
  async speak(text: string, options?: { speed?: number; loop?: boolean }) {
    (await this.ready).speakKana(text, options);
  }

  /** Plays a motion by id (see `avatar.motions`). Waits for the avatar to load. */
  async play(id: string) {
    (await this.ready).play(id);
  }

  connectedCallback() {
    this.#observer ??= new IntersectionObserver(entries => {
      this.#onScreen = entries.at(-1)?.isIntersecting ?? true;
      this.#updateLoop();
    });
    this.#observer.observe(this);
    document.addEventListener('visibilitychange', this.#updateLoop);
    if (!this.#avatar && !this.#loading) this.#scheduleLoad();
    else this.#updateLoop();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    document.removeEventListener('visibilitychange', this.#updateLoop);
    this.#stopLoop();
    // Moving the element elsewhere in the page reconnects it at once; keep the avatar then.
    queueMicrotask(() => { if (!this.isConnected) this.#unload(); });
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value) return;
    if (name === 'src' || name === 'fit') {
      if (name === 'src') this.#source = undefined;
      if (name === 'fit' && parseFit(value) === undefined) this.#warn(name, value);
      if (this.isConnected) this.#scheduleLoad();
    } else if (name === 'label') {
      this.#canvas.setAttribute('aria-label', value || 'Avatar');
    } else if (name === 'paused') {
      this.#updateLoop();
    } else if (this.#avatar) {
      this.#apply(this.#avatar, name);
    }
  }

  #apply(avatar: MeshAvatar, name: string) {
    if (name === 'expression') {
      const expression = parseExpression(this.getAttribute('expression'));
      if (expression) avatar.setExpression(expression); else this.#warn(name, this.getAttribute(name));
    } else if (name === 'emotion') {
      const emotion = parseEmotion(this.getAttribute('emotion'));
      if (emotion !== undefined) avatar.setEmotion(emotion); else this.#warn(name, this.getAttribute(name));
    } else if (name === 'no-idle') {
      avatar.setAutoIdle(!this.hasAttribute('no-idle'));
    }
  }

  #scheduleLoad() {
    this.#ready.start();
    if (this.#scheduled) return;
    const reservation = this.#scheduled = {};
    queueMicrotask(() => {
      if (this.#scheduled !== reservation) return;
      this.#scheduled = null;
      if (this.isConnected) void this.#load();
    });
  }

  async #load(source: AvatarSource = this.#source ?? (this.getAttribute('src') || DEFAULT_SRC)) {
    const id = ++this.#loadId;
    this.#unload(false);
    this.#loading = true;
    this.#ready.start();
    try {
      const avatar = await loadMeshAvatar(this.#canvas, source, { manual: true, fit: this.fit });
      if (id !== this.#loadId) { avatar.destroy(); return; }
      this.#loading = false;
      this.#avatar = avatar;
      for (const name of ['expression', 'emotion', 'no-idle']) {
        if (name !== 'emotion' || this.hasAttribute(name)) this.#apply(avatar, name);
      }
      if (this.#voiceLevel !== null) avatar.setVoiceLevel(this.#voiceLevel);
      // Hair moves less for people who ask for reduced motion; the avatar itself still moves.
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) avatar.setSwayGain(0.5);
      avatar.onMotion(motion => this.dispatchEvent(new CustomEvent('motion', { detail: { id: motion } })));
      avatar.advance(0);
      this.#ready.resolve(avatar);
      this.dispatchEvent(new CustomEvent('load', { detail: { avatar } }));
      this.#updateLoop();
    } catch (error) {
      if (id !== this.#loadId) return;
      this.#loading = false;
      this.#ready.reject(error);
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    }
  }

  /** Destroys the avatar. Without `cancel = false` it also abandons a load in progress. */
  #unload(cancel = true) {
    if (cancel) { this.#loadId++; this.#loading = false; }
    this.#stopLoop();
    this.#avatar?.destroy();
    this.#avatar = null;
  }

  #updateLoop = () => {
    const run = this.#avatar && this.isConnected && this.#onScreen && !document.hidden && !this.paused;
    if (run && !this.#raf) {
      this.#previous = performance.now();
      this.#raf = requestAnimationFrame(this.#frame);
    } else if (!run) {
      this.#stopLoop();
    }
  };

  #frame = (now: number) => {
    const seconds = frameSeconds(now, this.#previous);
    this.#previous = now;
    this.#avatar?.advance(seconds, 1 / seconds);
    this.#raf = requestAnimationFrame(this.#frame);
  };

  #stopLoop() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  #warn(name: string, value: string | null) {
    const key = `${name}=${value}`;
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    console.warn(`<mesh-avatar> ignores ${name}="${value}".`);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('mesh-avatar')) {
  customElements.define('mesh-avatar', MeshAvatarElement);
}

declare global {
  interface HTMLElementTagNameMap { 'mesh-avatar': MeshAvatarElement }
}
