import { useState } from 'react';
import { liveText } from './i18n';
import type { MicState } from './media';

interface Props {
  language: keyof typeof liveText;
  ready: boolean;
  devices: MediaDeviceInfo[];
  state: MicState;
  gain: number;
  onGainChange: (gain: number) => void;
  onStart: (deviceId: string) => void;
  onStop: () => void;
}

export function MicrophoneControls({ language, ready, devices, state, gain, onGainChange, onStart, onStop }: Props) {
  const t = liveText[language];
  const [deviceId, setDeviceId] = useState('');
  const active = state === 'micStarting' || state === 'micOn';
  const inputs = devices.filter(device => device.kind === 'audioinput' && device.deviceId);

  return <section>
    <h2>{t.microphone}</h2>
    <label>{t.device}<select value={deviceId} disabled={active} onChange={event => setDeviceId(event.target.value)}>
      <option value="">{t.defaultDevice}</option>
      {inputs.map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t.microphone} ${i + 1}`}</option>)}
    </select></label>
    <div className="live-buttons">
      <button type="button" className="live-primary" disabled={!active && !ready} onClick={active ? onStop : () => onStart(deviceId)}>
        {active ? t.stopMicrophone : t.startMicrophone}
      </button>
    </div>
    <p role="status">{t[state]}</p>
    <label>{t.gain}<input type="range" min="0.25" max="5" step="0.05" value={gain} onChange={event => onGainChange(Number(event.target.value))} /></label>
  </section>;
}
