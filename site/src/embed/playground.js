export function setupPlayground(root, { sampleURL, messages }) {
  const el = root.querySelector('mesh-avatar');
  const mouthStyles = {
    calm: { granularity: 0, openness: 0.5, closeSpeed: 0 },
    default: { granularity: 0.5, openness: 0.5, closeSpeed: 0.5 },
    lively: { granularity: 1, openness: 0.5, closeSpeed: 1 },
    subtle: { granularity: 0.5, openness: 0, closeSpeed: 0.5 },
    big: { granularity: 0.5, openness: 1, closeSpeed: 0.5 },
  };
  const mouthStyle = root.querySelector('#mouth-style');

  const status = root.querySelector('#status');
  const sourceName = root.querySelector('#source-name');
  const selectedFile = root.querySelector('#selected-file');
  const selectedPrefix = selectedFile.textContent.replace(/Miko$/, '');
  const controls = root.querySelector('#avatar-controls');
  const notice = root.querySelector('#notice');
  const speechText = root.querySelector('#speech-text');
  const fileInput = root.querySelector('#avatar-file');

  root.querySelector('#mouth-style-label').textContent = messages.mouthStyle;
  root.querySelector('#mouth-style-hint').textContent = messages.mouthStyleHint;
  const custom = new Option(messages.customMouthStyle, ''); custom.disabled = true; custom.hidden = true;
  mouthStyle.add(custom);
  for (const name of Object.keys(mouthStyles)) mouthStyle.add(new Option(messages.mouthStyles[name], name));

  function mouthStyleCode(settings) {
    const fields = ['granularity', 'openness', 'closeSpeed'].map(key => `${key}: ${settings[key]}`).join(', ');
    updateCode('mouth-style-code', `const el = document.querySelector('mesh-avatar');\nel.setLipSync({ ${fields} });`);
  }
  mouthStyle.addEventListener('change', () => {
    const settings = mouthStyles[mouthStyle.value];
    el.setLipSync(settings); mouthStyleCode(settings);
  });

  function updateCode(id, text) {
    root.querySelector(`#${id}`).textContent = text;
    const copy = root.querySelector(`[data-copy="${id}"]`);
    copy.textContent = copy.dataset.label;
  }

  function loading(name) {
    sourceName.textContent = name;
    selectedFile.textContent = selectedPrefix + name;
    status.textContent = root.dataset.loading;
    status.dataset.state = 'loading';
    controls.disabled = true;
    notice.textContent = '';
  }

  function ready() {
    const settings = { granularity: 0.5, openness: 0.5, closeSpeed: 0.5,
      ...el.avatar?.package?.manifest.lipSync, ...el.lipSync };
    mouthStyle.value = Object.keys(mouthStyles).find(name =>
      Object.keys(mouthStyles[name]).every(key => mouthStyles[name][key] === settings[key])) ?? '';
    mouthStyleCode(settings);

    status.textContent = root.dataset.ready;
    status.dataset.state = 'ready';
    controls.disabled = false;
  }

  el.addEventListener('load', ready);
  el.addEventListener('error', () => {
    status.textContent = root.dataset.error;
    status.dataset.state = 'error';
    controls.disabled = true;
  });

  for (const button of root.querySelectorAll('[data-expression]')) {
    button.addEventListener('click', () => {
      const expression = button.dataset.expression;
      if (expression === 'neutral') el.removeAttribute('expression');
      else el.expression = expression;
      for (const chip of root.querySelectorAll('[data-expression]')) {
        chip.setAttribute('aria-pressed', String(chip === button));
      }
      updateCode('expression-code', expression === 'neutral'
        ? '<mesh-avatar></mesh-avatar>'
        : `<mesh-avatar expression="${expression}"></mesh-avatar>`);
    });
  }

  function speechCode() {
    // Escape a single-quoted JavaScript string; textContent keeps HTML inert.
    const text = speechText.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      .replace(/\r/g, '\\r').replace(/\n/g, '\\n')
      .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
      .replace(/</g, '\\x3c');
    updateCode('speech-code', `const el = document.querySelector('mesh-avatar');\nel.speak('${text}');`);
  }
  speechText.addEventListener('input', speechCode);
  root.querySelector('#speech-form').addEventListener('submit', event => {
    event.preventDefault();
    speechCode();
    void el.speak(speechText.value).catch(() => {
      notice.textContent = root.dataset.error;
    });
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    loading(file.name);
    updateCode('file-code', '<mesh-avatar src="/path/to/your-avatar.mavatar"></mesh-avatar>');
    void el.load(file).catch(() => {});
    fileInput.value = '';
  });
  root.querySelector('#restore-miko').addEventListener('click', () => {
    loading('Miko');
    updateCode('file-code', '<mesh-avatar></mesh-avatar>');
    // load() reloads even when the src attribute is already absent.
    void el.load(sampleURL).catch(() => {});
    fileInput.value = '';
  });

  for (const button of root.querySelectorAll('[data-copy], #copy-snippet')) {
    button.dataset.label = button.textContent;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(root.querySelector(`#${button.dataset.copy ?? 'embed-code'}`).textContent);
        button.textContent = button.dataset.copied;
      } catch {
        notice.textContent = root.dataset.copyError;
      }
    });
  }
  if (el.avatar) ready();
}
