import type { Rig } from 'mesh-avatar';
import { useI18n, type PartGroup } from './i18n';
import { PART_COLORS, partPresent, SECTIONS } from './parts';
import { Icon } from './Icon';
export function PartList({ rig, visible, selected, onSelect, onFocus, onVisible }: {
  rig: Rig; visible: string[]; selected: string | null; onSelect: (group: string) => void; onFocus: (group: string) => void; onVisible: (groups: string[]) => void;
}) {
  const { t, parts } = useI18n();
  const section = (groups: readonly PartGroup[]) => {
    const available = groups.filter(group => partPresent(rig, group));
    const allShown = available.every(group => visible.includes(group));
    return <>
      <button className="icon-button section-eye" disabled={!available.length} title={allShown ? t.hideAll : t.showAll}
        aria-label={`${allShown ? t.hideAll : t.showAll} · ${groups.map(g => parts[g][0]).join(', ')}`}
        onClick={() => onVisible(allShown ? visible.filter(g => !available.includes(g as PartGroup)) : [...new Set([...visible, ...available])])}>
        <Icon name={allShown ? 'eye' : 'hidden'} />
      </button>
      <div className="part-rows">{groups.map(group => {
        const present = partPresent(rig, group), shown = present && visible.includes(group);
        return <div key={group} className={`part-row ${selected?.split('.')[0] === group ? 'is-selected' : ''} ${present ? '' : 'is-absent'}`}
          data-part={group} data-visible={shown}>
          <button className="part-select" data-testid={`part-${group}`} disabled={!present}
            aria-pressed={selected?.split('.')[0] === group} onClick={() => onSelect(group)} onDoubleClick={() => onFocus(group)}>
            <span className="part-swatch" style={{ background: PART_COLORS[group] }} />
            <span><strong>{parts[group][0]}</strong><small title={present ? parts[group][1] : t.notPresent}>{present ? parts[group][1] : t.notPresent}</small></span>
          </button>
          <button className="icon-button part-eye" disabled={!present} data-testid={`visibility-${group}`}
            aria-label={`${shown ? t.hide : t.show} · ${parts[group][0]}`} title={shown ? t.hide : t.show} aria-pressed={shown}
            onClick={() => onVisible(shown ? visible.filter(g => g !== group) : [...visible, group])}>
            <Icon name={shown ? 'eye' : 'hidden'} />
          </button>
        </div>;
      })}</div>
    </>;
  };
  return <aside className="panel parts-panel" aria-label={t.parts}>
    <details className="parts-disclosure" open><summary className="parts-title">{t.parts}</summary>
    {SECTIONS.map(s => s.key === 'advanced'
      ? <details key={s.key} className="part-section advanced-section"><summary>{t[s.key]}</summary>{section(s.groups)}</details>
      : <section key={s.key} className="part-section"><h3>{t[s.key]}</h3>{section(s.groups)}</section>)}
    </details>
  </aside>;
}
