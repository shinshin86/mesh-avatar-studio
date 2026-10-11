import { useEffect, useState } from 'react';
import { editorNumber, isIntegerField } from '../../packages/runtime/src/rig/numeric';

export function NumericField({ path, value, label, onChange }: {
  path: string; label?: string; value: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label title={path}><span>{label}</span>
      <input type="number" step={isIntegerField(path) ? 1 : 0.1} aria-label={path} value={draft}
        onChange={event => {
          const number = event.target.valueAsNumber;
          const rounded = editorNumber(path, number);
          setDraft(Number.isFinite(number) && isIntegerField(path) ? String(rounded) : event.target.value);
          if (Number.isFinite(number)) onChange(rounded);
        }}
        onBlur={() => setDraft(String(value))} /><small className="field-path">{path}</small>
    </label>
  );
}
