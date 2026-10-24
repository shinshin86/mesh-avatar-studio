import { useEffect, useRef, useState } from 'react';
import { type LipSyncSettings as Settings, type MeshAvatar } from 'mesh-avatar';
import { rmsLevel } from '../live/tracking';
import { useI18n } from './i18n';

const presets = {
  calm: { granularity: 0, openness: 0.5, closeSpeed: 0 },
  default: { granularity: 0.5, openness: 0.5, closeSpeed: 0.5 },
  lively: { granularity: 1, openness: 0.5, closeSpeed: 1 },
  subtle: { granularity: 0.5, openness: 0, closeSpeed: 0.5 },
  big: { granularity: 0.5, openness: 1, closeSpeed: 0.5 },
} as const;
type Preset = keyof typeof presets;
const presetNames = Object.keys(presets) as Preset[];

export const lipSyncText = {
  en: {
    movementTitle: 'Mouth movement style', calm: 'Relaxed', default: 'Standard', lively: 'Snappy', subtle: 'Subtle', big: 'Expressive', custom: 'Custom',
    demoHint: 'Choose a style to see it talk.', granularity: 'Mouth movement', granularityLow: 'Relaxed', granularityHigh: 'Snappy',
    openness: 'Mouth size', opennessLow: 'Small', opennessHigh: 'Large', closeSpeed: 'Closing', closeSpeedLow: 'Smooth', closeSpeedHigh: 'Crisp',
    advanced: 'Fine-tune', title: 'Audio lip sync',
    file: 'Preview a local audio file', noFile: 'No audio selected', stop: 'Stop audio preview',
    hint: 'Settings are included in the avatar when saved or exported. The selected audio stays in this browser.', error: 'Could not play this audio file.',
  },
  ja: {
    movementTitle: '口の動きのタイプ', calm: 'ゆったり', default: '標準', lively: 'キビキビ', subtle: '控えめ', big: 'はっきり', custom: 'カスタム',
    demoHint: '選ぶとすぐに口の動きを試せます。', granularity: '口の動き', granularityLow: 'ゆったり', granularityHigh: 'キビキビ',
    openness: '口の大きさ', opennessLow: '小さく', opennessHigh: '大きく', closeSpeed: '閉じ方', closeSpeedLow: 'なめらか', closeSpeedHigh: 'パクパク',
    advanced: '細かく調整する', title: '音声リップシンク',
    file: '音声ファイルで試す', noFile: '音声未選択', stop: '音声プレビューを停止',
    hint: '設定は保存・書き出し時にアバターへ含めます。選んだ音声はこのブラウザ内で再生します。', error: 'この音声ファイルを再生できませんでした。',
  },
  zh: {
    movementTitle: '口型动作风格', calm: '舒缓', default: '标准', lively: '轻快', subtle: '含蓄', big: '鲜明', custom: '自定义',
    demoHint: '选择风格即可预览口型动作。', granularity: '口型动作', granularityLow: '舒缓', granularityHigh: '轻快',
    openness: '张嘴幅度', opennessLow: '小', opennessHigh: '大', closeSpeed: '闭嘴方式', closeSpeedLow: '平滑', closeSpeedHigh: '利落',
    advanced: '精细调整', title: '语音口型同步',
    file: '预览本地音频文件', noFile: '未选择音频', stop: '停止音频预览',
    hint: '保存或导出时，设置将包含在虚拟形象中。所选音频仅在此浏览器中播放。', error: '无法播放此音频文件。',
  },
};

export function LipSyncSettings({ value, onChange, avatar, onPreview, onDemo }: {
  value?: Settings; onChange(value: Settings): void; avatar: MeshAvatar | null; onPreview(active: boolean): void; onDemo(): void;
}) {
  const { language } = useI18n(), t = lipSyncText[language];
  const settings = { granularity: 0.5, openness: 0.5, closeSpeed: 0.5, ...value } as Required<Omit<Settings, 'preset'>> & Pick<Settings, 'preset'>;
  const [url, setUrl] = useState(''), [fileName, setFileName] = useState(''), [failed, setFailed] = useState(false);
  const pendingSlider = useRef(false);
  const selected = settings.preset === 'custom' ? 'custom' : presetNames.find(name =>
    (['granularity', 'openness', 'closeSpeed'] as const).every(key => presets[name][key] === settings[key])) ?? 'custom';
  const apply = (next: typeof settings) => {
    settingsRef.current = next;
    avatar?.setLipSync(next);
    onChange(next);
  };
  const commitSlider = () => {
    if (!pendingSlider.current) return;
    pendingSlider.current = false;
    stop(); onDemo();
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null), context = useRef<AudioContext | null>(null), analyser = useRef<AnalyserNode | null>(null);
  const raf = useRef(0), settingsRef = useRef(settings); settingsRef.current = settings;
  const previewRef = useRef(onPreview); previewRef.current = onPreview;
  const stop = () => {
    cancelAnimationFrame(raf.current); raf.current = 0;
    audio.current?.pause(); avatar?.setSpeaking(false); avatar?.setVoiceLevel(0);
    previewRef.current(false);
  };
  useEffect(() => {
    avatar?.setLipSync(settings);
  }, [avatar, settings.granularity, settings.openness, settings.closeSpeed]);
  useEffect(() => () => {
    cancelAnimationFrame(raf.current); raf.current = 0; audio.current?.pause();
    avatar?.setSpeaking(false); previewRef.current(false);
  }, [avatar]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { void context.current?.close().catch(() => undefined); }, []);
  const play = async () => {
    if (!avatar || !audio.current) return;
    setFailed(false);
    try {
      if (!context.current) {
        const ctx = new AudioContext(); context.current = ctx;
        const node = ctx.createAnalyser(); node.fftSize = 2048; analyser.current = node;
        ctx.createMediaElementSource(audio.current).connect(node); node.connect(ctx.destination);
      }
      await context.current.resume();
      if (audio.current.paused) return;
      avatar.stopLipSync(); avatar.setSpeaking(true); previewRef.current(true);
      const samples = new Float32Array(2048);
      cancelAnimationFrame(raf.current);
      const frame = () => {
        if (!analyser.current || !context.current || !audio.current || audio.current.paused) return;
        analyser.current.getFloatTimeDomainData(samples);
        avatar.setVoiceLevel(rmsLevel(samples.subarray(1024), 1));
        raf.current = requestAnimationFrame(frame);
      };
      raf.current = requestAnimationFrame(frame);
    } catch { stop(); setFailed(true); }
  };
  return <div className="audio-lip-settings" data-testid="audio-lip-settings" role="group" aria-label={t.title}>
    <div className="audio-lip-heading"><h3>{t.movementTitle}</h3>{selected === 'custom' && <span className="audio-lip-custom" role="status">{t.custom}</span>}</div>
    <div className="audio-lip-presets" role="group" aria-label={t.movementTitle}>
      {presetNames.map(name => <button type="button" key={name} aria-pressed={selected === name} disabled={!avatar} onClick={() => {
        pendingSlider.current = false;
        stop(); apply({ ...settings, ...presets[name], preset: name }); onDemo();
      }}>{t[name]}</button>)}
    </div>
    <p className="audio-lip-demo-hint">{t.demoHint}</p>
    <details className="audio-lip-advanced" onToggle={event => { if (!event.currentTarget.open) stop(); }}><summary>{t.advanced}</summary><div>
      <div className="audio-lip-sliders">
        {(['granularity', 'openness', 'closeSpeed'] as const).map(key => <label key={key}>
          <span>{t[key]}</span><input type="range" aria-label={t[key]} min="0" max="1" step="0.05" value={settings[key]}
            onChange={event => { pendingSlider.current = true; apply({ ...settingsRef.current, [key]: Number(event.target.value), preset: 'custom' }); }}
            onPointerUp={commitSlider} onKeyUp={commitSlider} onBlur={commitSlider} />
          <small className="audio-lip-range"><span>{t[`${key}Low`]}</span><span>{t[`${key}High`]}</span></small>
        </label>)}
      </div>
      <div className="audio-file-picker">
        <input ref={fileInput} type="file" hidden aria-label={t.file} accept="audio/*,.wav,.aiff" onChange={event => {
          stop(); setFailed(false); const file = event.target.files?.[0]; setFileName(file?.name ?? ''); setUrl(file ? URL.createObjectURL(file) : ''); event.target.value = '';
        }} />
        <button type="button" disabled={!avatar} onClick={() => fileInput.current?.click()}>{t.file}</button>
        <span role="status" aria-live="polite">{fileName || t.noFile}</span>
      </div>
      <audio ref={audio} src={url || undefined} controls hidden={!url} onPlay={() => { void play(); }} onPause={stop} onEnded={stop} onError={() => { if (url) { stop(); setFailed(true); } }} />
      {url && <button onClick={stop}>{t.stop}</button>}
      <small>{t.hint}</small>{failed && <p role="alert">{t.error}</p>}
    </div></details>
  </div>;
}
