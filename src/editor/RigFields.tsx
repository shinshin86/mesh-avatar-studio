import { clothGrid, sampleLine } from '../../packages/runtime/src/engine/cloth-grid.js';
import type { Cloth, Point, Rig } from 'mesh-avatar';
import { getAt } from './model';
import { NumericField } from './NumericField';
import { useI18n } from './i18n';
import { LEG_DEFAULTS } from '../../packages/runtime/src/engine/legs.js';
import { CLOTH_DEFAULTS } from '../../packages/runtime/src/engine/cloth-tuning.js';

export function RigFields({ rig, path, scope = path, onChange }: {
  rig: Rig; path: string; scope?: string; onChange: (path: string, value: unknown) => void;
}) {
  const { t, title } = useI18n();
  const label = title(path.startsWith('legs.split') ? path : path === scope ? path.split('.').at(-1)! : path.slice(scope.length + 1));
  const value = getAt(rig, path);
  if (typeof value === 'number') return <NumericField path={path} label={label} value={value} onChange={number => onChange(path, number)} />;
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number') && !/band$/i.test(path)) {
    return <div className="point-field"><span>{label}</span><div className="point-inputs">
      {value.map((number, index) => <NumericField key={index} path={`${path}.${index}`} label={index === 0 ? t.x : t.y}
        value={number} onChange={next => onChange(`${path}.${index}`, next)} />)}
    </div><small>{path}</small></div>;
  }
  const fields = /^cloth\.\d+$/.test(path) ? { ...CLOTH_DEFAULTS, ...value } : path === 'legs' ? { ...LEG_DEFAULTS, ...value } : value;
  const children = Object.entries(fields).map(([key, child]) =>
    (/^cloth\.\d+$/.test(path) && Object.hasOwn(CLOTH_DEFAULTS, key)) || (path === 'legs' && Object.hasOwn(LEG_DEFAULTS, key))
      ? <NumericField key={key} path={`${path}.${key}`} label={title(key)} value={child as number} onChange={number => onChange(`${path}.${key}`, number)} />
      : <RigFields key={key} rig={rig} path={`${path}.${key}`} scope={scope} onChange={onChange} />);

  if (/^cloth\.\d+$/.test(path)) {
    const cloth = value as Cloth;
    const add = (kind: 'seams' | 'tiers') => {
      if (kind === 'tiers') {
        const lines = cloth.tiers ?? [];
        let line: Point[];
        try {
          const grid = clothGrid(cloth);
          line = grid.seams.map((seam: Point[], k: number) => sampleLine(seam, ((lines.length ? grid.joints[k].at(-2)! : 0) + 1) / 2) as Point);
        } catch { return; }
        onChange(`${path}.tiers`, [...lines, line]);
      } else {
        const lines = cloth.seams?.length ? cloth.seams : [0, 1].map(t => [sampleLine(cloth.waist, t), sampleLine(cloth.hem, t)] as Point[]);
        if (!cloth.seams?.length) { onChange(`${path}.seams`, lines); return; }
        let gap = 0; for (let i = 1; i < lines.length - 1; i++) if (lines[i + 1][0][0] - lines[i][0][0] > lines[gap + 1][0][0] - lines[gap][0][0]) gap = i;
        const line = Array.from({ length: 5 }, (_, j) => { const a = sampleLine(lines[gap], j / 4), b = sampleLine(lines[gap + 1], j / 4); return a.map((v: number, k: number) => (v + b[k]) / 2) as Point; });
        const next = [...lines]; next.splice(gap + 1, 0, line); onChange(`${path}.seams`, next);
      }
    };
    return <details open><summary>{cloth.name}</summary><div className="fields">{children}
      <div>{(['seams', 'tiers'] as const).map(kind => <button key={kind} type="button" onClick={() => add(kind)}>{title(kind === 'seams' ? 'addSeam' : 'addTier')}</button>)}</div>
    </div></details>;
  }
  if (/^cloth\.\d+\.(seams|tiers)\.\d+$/.test(path)) {
    const arrayPath = path.split('.').slice(0, -1).join('.'), lines = getAt(rig, arrayPath) as Point[][];
    return <details open><summary>{label}</summary><button type="button" onClick={() => { const next = lines.filter((_, i) => i !== Number(path.split('.').at(-1))); onChange(arrayPath, arrayPath.endsWith('seams') && next.length < 2 ? [] : next); }}>{title('deleteLine')}</button><div className="fields">{children}</div></details>;
  }
  if (Array.isArray(value)) return <details open={path === 'eyes' || path === 'strands'}><summary>{label} ({value.length})</summary><div className="fields">{children}</div></details>;
  return <>{children}</>;
}
