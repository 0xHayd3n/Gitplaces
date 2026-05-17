import type { AnatomyPayload } from '../types/repo'

export default function AnatomyIndicators({
  payload, updateAvailable,
}: { payload: AnatomyPayload; updateAvailable: number | null }) {
  const rules = payload.model?.rules.length ?? 0
  const decisions = payload.model?.decisions.length ?? 0
  const mem = payload.memory.length
  const stale = updateAvailable === 1
  const fpAnatomy = (payload.model?.generated?.fingerprint as string | undefined) ?? payload.fingerprint
  const fpMismatch = !!payload.rawMemory && !!fpAnatomy && !!payload.fingerprint && fpAnatomy !== payload.fingerprint

  return (
    <div className="anatomy-indicators">
      <span className={`anatomy-source-badge anatomy-source-${payload.source}`}>{payload.source}</span>
      <span className="anatomy-count">{rules} rule{rules === 1 ? '' : 's'}</span>
      <span className="anatomy-count">{decisions} decision{decisions === 1 ? '' : 's'}</span>
      <span className="anatomy-count">{mem} memory {mem === 1 ? 'entry' : 'entries'}</span>
      <span className={`anatomy-freshness ${stale ? 'is-stale' : 'is-fresh'}`}>{stale ? 'stale' : 'fresh'}</span>
      {fpMismatch && <span className="anatomy-fp-warn">memory may be stale</span>}
    </div>
  )
}
