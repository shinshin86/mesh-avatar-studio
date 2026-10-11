import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { variantNames, projectVariantRequests, openSampleAvatar, ProjectJobError, type LocalProject, type ProjectJob, type JobResult, type VariantRequest } from './project';
import { AskAgent } from './AskAgent';
import { JobFeedback } from './JobFeedback';
import { CopyButton } from './CopyButton';
import { Icon } from './Icon';

const labels = ['eyesClosed', 'eyesHalf', 'eyesSmile', 'mouthA', 'mouthAHalf', 'mouthI', 'mouthO'] as const;
export function VariantsPanel({ project, projectPath, assets, rootPath, busy, stale, onRun, mouthRequest, onMouthPresence }: {
  project: LocalProject | null; projectPath?: string; assets?: Record<string, string>; rootPath?: string; busy: boolean; stale: boolean;
  onRun: (action: ProjectJob, files?: File[]) => Promise<JobResult>; mouthRequest: number; onMouthPresence: (present: boolean) => void;
}) {
  const { t } = useI18n();
  const [present, setPresent] = useState<string[]>([]), [requests, setRequests] = useState<VariantRequest[]>([]);
  const [eyes, setEyes] = useState(false), [mouth, setMouth] = useState(false);
  const target = eyes && mouth ? 'both' : eyes ? 'eyes' : 'mouth';
  const panel = useRef<HTMLDetailsElement>(null), mouthCheckbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!mouthRequest) return;
    setMouth(true);
    if (panel.current) { panel.current.open = true; panel.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    mouthCheckbox.current?.focus({ preventScroll: true });
  }, [mouthRequest]);
  const [error, setError] = useState<ProjectJobError | null>(null), [log, setLog] = useState(''), [accepted, setAccepted] = useState(false), [notice, setNotice] = useState('');
  const [lastAction, setLastAction] = useState<ProjectJob>('variant-requests');
  const input = useRef<HTMLInputElement>(null), current = useRef(0);
  const writable = !!project && !project.readOnly;
  // Loading metadata for the current project must not reset choices made during loading.
  const identity = project?.relativePath ?? projectPath;
  useEffect(() => { setEyes(false); setMouth(false); setError(null); setLog(''); setAccepted(false); setNotice(''); }, [identity]);
  useEffect(() => {
    const revision = ++current.current;
    setPresent([]); setRequests([]);
    void Promise.resolve(assets ?? openSampleAvatar().then(value => value.assets)).then(loaded => {
      const url = loaded['sprites/sprites.json'];
      return url ? fetch(url).then(response => response.ok ? response.json() : null) : null;
    }).then(data => {
      if (revision !== current.current) return;
      const ready = data?.layers ? variantNames.filter(name => name.startsWith('eyes_') ? `${name}_0` in data.layers && `${name}_1` in data.layers : name in data.layers) : [];
      setPresent(ready); onMouthPresence(ready.some(name => name.startsWith('mouth_')));
    }).catch(() => { if (revision === current.current) onMouthPresence(false); });
    if (project) void projectVariantRequests(project).then(value => { if (revision === current.current) setRequests(value); });
  }, [project?.name, assets, onMouthPresence]);
  const run = async (action: ProjectJob, files?: File[]) => {
    setLastAction(action);
    setError(null); setLog(''); setAccepted(false); setNotice('');
    try {
      const result = await onRun(action, files);
      setLog(result.log); if (result.requests) { setRequests(result.requests); setNotice(t.requestsReady); }
      setAccepted(action === 'import-variants');
    } catch (error) { setError(error instanceof ProjectJobError ? error : new ProjectJobError('toolFailed')); }
  };
  const count = (prefix: string, total: number) => {
    const value = present.filter(name => name.startsWith(prefix)).length;
    return value ? t.variantCount.replace('COUNT', String(value)).replace('TOTAL', String(total)) : t.variantMissing;
  };
  return <details ref={panel} className="panel variants-panel" data-testid="variants-panel" open>
    <summary><Icon name="brush" />{t.variantsTitle}</summary>
    <div className="variants-content"><p>{t.variantsHelp}</p>
      <div className="variant-choices">
        <label><input type="checkbox" checked={eyes} onChange={event => setEyes(event.target.checked)} aria-label={t.targetEyes} /><span>{t.targetEyes}<small>{t.eyesKinds}</small></span><span className="variant-count">{count('eyes_', 3)}</span></label>
        <label><input ref={mouthCheckbox} type="checkbox" checked={mouth} onChange={event => setMouth(event.target.checked)} aria-label={t.targetMouth} /><span>{t.targetMouth}<small>{t.mouthKinds}</small></span><span className="variant-count">{count('mouth_', 4)}</span></label>
      </div>
      {(eyes || mouth) && projectPath && (projectPath.startsWith('<') ? <p className="workflow-note">{t.agentUnknownPath}</p> : <AskAgent rootPath={rootPath} projectPath={project?.readOnly || projectPath === 'samples/miko-qipao' ? 'projects/miko-qipao-variants' : projectPath} readOnlySource={project?.readOnly || projectPath === 'samples/miko-qipao' ? projectPath : undefined} target={target} />)}
      <details className="manual-variants"><summary>{t.manualVariants}</summary>
        <p>{t.manualHelp}</p>
        {writable ? <button disabled={busy || stale} onClick={() => { void run('variant-requests'); }}>{busy ? t.operationBusy : t.createRequests}</button> : <p className="workflow-note">{t.variantsUnavailable}</p>}
        {stale && <p className="workflow-note">{t.variantsNeedRebuild}</p>}
      {requests.length > 0 && <div className="variant-requests">{requests.filter(request => (!eyes && !mouth) || target === 'both' || request.name.startsWith(target === 'eyes' ? 'eyes_' : 'mouth_')).map(request => <details key={request.name}>
        <summary>{t[labels[variantNames.indexOf(request.name)]]} · <code>{request.name}.png</code></summary>
        <img src={request.maskUrl} alt={`${t.requestFiles}: ${t[labels[variantNames.indexOf(request.name)]]}`} />
        <p><code>{project?.relativePath}/source.png</code><br /><code>{project?.relativePath}/variant-requests/{request.name}/mask.png</code></p>
        <div className="workflow-buttons"><CopyButton value={request.prompt} label={t.copyVariantPrompt} /><CopyButton value={`${project?.relativePath}/source.png\n${project?.relativePath}/variant-requests/${request.name}/mask.png\n${project?.relativePath}/variant-requests/${request.name}/prompt.md`} label={t.copyFilePaths} /></div>
        <pre>{request.prompt}</pre><p>{t.variantOutput}: <code>{project?.relativePath}/variants/{request.name}.png</code></p>
      </details>)}</div>}
      {writable && <div className="variant-drop" data-testid="variant-drop" aria-disabled={busy || stale} onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); if (!busy && !stale) void run('import-variants', Array.from(event.dataTransfer.files)); }}>
        <strong>{t.dropVariants}</strong><p>{t.variantFilenameHelp}</p><button disabled={busy || stale} onClick={() => input.current?.click()}>{t.chooseVariants}</button>
        <input ref={input} hidden multiple type="file" accept=".png,image/png" aria-label={t.variantFiles} disabled={busy || stale} onChange={event => { if (event.target.files) void run('import-variants', Array.from(event.target.files)); event.target.value = ''; }} />
      </div>}
      </details>
      {notice && <p role="status">{notice}</p>}<JobFeedback error={error} log={log} accepted={accepted} importing={lastAction === 'import-variants'} />
    </div>
  </details>;
}
