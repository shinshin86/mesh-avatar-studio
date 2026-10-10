import type { Rig } from 'mesh-avatar';
import { jobReason } from './job-reason';
import { useI18n } from './i18n';
import { ProjectJobError } from './project';

export function JobFeedback({ error, log = '', accepted = false, importing = false, rig }: { error?: ProjectJobError | null; log?: string; accepted?: boolean; importing?: boolean; rig?: Rig }) {
  const { t, title } = useI18n();
  const details = error?.log || log;
  const reason = error?.code === 'dependencies' ? t.dependenciesHelp : error?.code === 'unsafeFiles' ? t.unsafeFilesHelp : error?.code === 'invalidImages' ? t.importInvalid : jobReason(details, t, rig, title) ?? (/outside-mask changes/.test(details) ? t.importOutside : /expected PNG size/.test(details) ? t.importSize : /mask/.test(details) ? t.importMask : t.jobFailed);
  const metrics = [...details.matchAll(/(eyes_\w+|mouth_\w+): outside-mask max ([\d.]+)\/255, mean ([\d.]+)\/255, (\d+) pixels over tolerance ([\d.]+)/g)];
  return <div className="job-feedback" data-testid="job-feedback">
    {error && <p role="alert">{error.code === 'reloadFailed' ? t.reloadFailed : <>{importing ? t.importRejected : t.jobFailed}{reason !== t.jobFailed && ` ${reason}`}</>}</p>}
    {accepted && <p role="status">{t.importAccepted}</p>}
    {metrics.length > 0 && <details><summary>{t.metricsTitle}</summary>{metrics.map(metric => <p key={metric[1]}><code>{metric[1]}</code>: {t.outsideMax} {metric[2]}/255 · {t.outsideMean} {metric[3]}/255 · {t.outsidePixels} {metric[4]} ({metric[5]}/255)</p>)}</details>}
    {details && <details><summary>{t.showLog}</summary><pre>{details}</pre></details>}
  </div>;
}
