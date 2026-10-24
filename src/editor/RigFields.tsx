import type { Rig } from 'mesh-avatar';
import { getAt } from './model';
import { NumericField } from './NumericField';
import { useI18n } from './i18n';
import { CLOTH_DEFAULTS } from '../../packages/runtime/src/engine/cloth-tuning.js';

export function RigFields({ rig, path, scope = path, onChange }: {
  rig: Rig; path: string; scope?: string; onChange: (path: string, value: number) => void;
}) {
  const { t, title } = useI18n();
  const label = title(path === scope ? path.split('.').at(-1)! : path.slice(scope.length + 1));
  const value = getAt(rig, path);
  if (typeof value === 'number') return <NumericField path={path} label={label} value={value} onChange={number => onChange(path, number)} />;
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number') && !/band$/i.test(path)) {
    return <div className="point-field"><span>{label}</span><div className="point-inputs">
      {value.map((number, index) => <NumericField key={index} path={`${path}.${index}`} label={index === 0 ? t.x : t.y}
        value={number} onChange={next => onChange(`${path}.${index}`, next)} />)}
    </div><small>{path}</small></div>;
  }
  const fields = /^cloth\.\d+$/.test(path) ? { ...CLOTH_DEFAULTS, ...value } : value;
  const children = Object.entries(fields).map(([key, child]) =>
    /^cloth\.\d+$/.test(path) && Object.hasOwn(CLOTH_DEFAULTS, key)
      ? <NumericField key={key} path={`${path}.${key}`} label={title(key)} value={child as number} onChange={number => onChange(`${path}.${key}`, number)} />
      : <RigFields key={key} rig={rig} path={`${path}.${key}`} scope={scope} onChange={onChange} />);
  if (Array.isArray(value)) return <details open={path === 'eyes' || path === 'strands'}><summary>{label} ({value.length})</summary><div className="fields">{children}</div></details>;
  if (/^cloth\.\d+$/.test(path)) return <details open><summary>{(value as { name: string }).name}</summary><div className="fields">{children}</div></details>;
  return <>{children}</>;
}
