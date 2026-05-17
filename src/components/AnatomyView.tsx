import { useState } from 'react'
import type { AnatomyPayload } from '../types/repo'

const PILLARS = ['stack', 'form', 'domain', 'function'] as const

export default function AnatomyView({ payload }: { payload: AnatomyPayload }) {
  const [raw, setRaw] = useState(false)
  const model = payload.model
  const showRaw = raw || !model

  return (
    <div className="anatomy-view">
      <div className="anatomy-view-toolbar">
        <button className="anatomy-raw-toggle" onClick={() => setRaw(r => !r)}>
          {showRaw && !model ? 'raw .anatomy (unparsed)' : raw ? 'structured view' : 'view raw .anatomy'}
        </button>
      </div>

      {showRaw ? (
        <pre className="anatomy-raw-pre">{payload.rawContent}</pre>
      ) : (
        <>
          <table className="anatomy-identity">
            <tbody>
              {PILLARS.map(p => (
                <tr key={p}>
                  <th>{p}</th>
                  <td>{String(model!.identity?.[p] ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {model!.rules.length > 0 && (
            <section className="anatomy-rules">
              <h4>Rules</h4>
              <ul>
                {model!.rules.map((r, i) => (
                  <li key={i}>
                    <span className="anatomy-rule-text">{r.statement}</span>
                    {r.verify?.kind && <span className="anatomy-rule-kind">[{r.verify.kind}]</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {model!.decisions.length > 0 && (
            <section className="anatomy-decisions">
              <h4>Decisions</h4>
              <ul>
                {model!.decisions.map((d, i) => (
                  <li key={i}>
                    <span className="anatomy-decision-text">{d.decision}</span>
                    {d.rationale && <span className="anatomy-decision-rationale"> {'—'} {d.rationale}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
