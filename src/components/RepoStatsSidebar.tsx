// src/components/RepoStatsSidebar.tsx
import { useState } from 'react'
import type { ReactNode } from 'react'
import { relativeTime } from '../utils/relativeTime'
import type { RepoStats, HealthStatus, IssueVelocity } from '../types/repoStats'
import './RepoStatsSidebar.css'

interface Props { stats: RepoStats | 'loading' | 'error' }

function fmt(n: number | null | undefined): string {
  if (n == null) return '--'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const STATUS_COLOR: Record<'active' | 'slow' | 'stale' | 'healthy' | 'backlogged' | 'critical', string> = {
  active: 'var(--green)', slow: 'var(--yellow)', stale: 'var(--red)',
  healthy: 'var(--green)', backlogged: 'var(--yellow)', critical: 'var(--red)',
}

type Verdict = { label: string; color: string; sub: string }

function computeVerdict(stats: RepoStats): Verdict {
  const { health, security, momentum } = stats
  const vulns = security.vulnerabilities
  const criticalVulns = vulns?.critical ?? 0
  const highVulns = vulns?.high ?? 0
  const totalVulns = vulns ? vulns.critical + vulns.high + vulns.moderate + vulns.low : 0

  const hasActiveSecrets = security.secretScanning != null && security.secretScanning.active > 0
  const hasCriticalCodeScan =
    typeof security.codeScanning === 'object' &&
    security.codeScanning !== null &&
    (security.codeScanning.critical > 0 || security.codeScanning.high > 0)

  if (security.available && (criticalVulns > 0 || highVulns > 0 || hasActiveSecrets || hasCriticalCodeScan)) {
    const severeCount = criticalVulns + highVulns
    const sub = hasActiveSecrets && severeCount === 0 && !hasCriticalCodeScan
      ? `${security.secretScanning!.active} active secret${security.secretScanning!.active === 1 ? '' : 's'} leaked`
      : hasCriticalCodeScan && severeCount === 0
      ? 'Critical or high code scanning findings'
      : `${severeCount} high-severity vulnerabilit${severeCount === 1 ? 'y' : 'ies'}`
    return { label: 'Critical issues', color: 'var(--red)', sub }
  }
  if (
    health.score < 40 ||
    health.maintenance === 'stale' ||
    health.issueVelocity === 'critical' ||
    (security.available && totalVulns > 0)
  ) {
    const sub = health.maintenance === 'stale'
      ? 'Repository activity is stalling'
      : health.issueVelocity === 'critical'
      ? 'Issue backlog is critical'
      : totalVulns > 0
      ? `${totalVulns} known vulnerabilit${totalVulns === 1 ? 'y' : 'ies'}`
      : 'Low health score'
    return { label: 'Needs attention', color: 'var(--yellow)', sub }
  }
  if (
    health.score >= 70 &&
    health.maintenance === 'active' &&
    (!security.available || totalVulns === 0)
  ) {
    const sub = momentum?.trend === 'up'
      ? 'Trending up'
      : momentum?.trend === 'down'
      ? 'Commit activity declining'
      : 'Actively maintained'
    return { label: 'Healthy', color: 'var(--green)', sub }
  }
  return { label: 'Stable', color: 'var(--t2)', sub: 'No critical signals' }
}

export function RepoStatsSidebar({ stats }: Props) {
  if (stats === 'loading') return <div className="stats-sidebar-loading" />
  if (stats === 'error')   return <div className="stats-sidebar-error">Failed to load stats.</div>

  const { vitals, health, momentum, security, engagement } = stats
  const totalVulns = security.vulnerabilities
    ? security.vulnerabilities.critical + security.vulnerabilities.high + security.vulnerabilities.moderate + security.vulnerabilities.low
    : 0

  const verdict = computeVerdict(stats)
  const healthColor = health.score >= 70 ? 'var(--green)' : health.score >= 40 ? 'var(--yellow)' : 'var(--red)'
  const circumference = 2 * Math.PI * 16
  const filled = (health.score / 100) * circumference

  return (
    <div className="stats-sidebar-enriched">

      {/* ── Verdict ── */}
      <div className="stats-verdict" style={{ borderLeftColor: verdict.color }}>
        <div className="stats-verdict-label" style={{ color: verdict.color }}>{verdict.label}</div>
        <div className="stats-verdict-sub">{verdict.sub}</div>
      </div>

      <div className="stats-divider" />

      {/* ── Vitals ── */}
      <section className="stats-section">
        <div className="stats-section-label">Vitals</div>
        <div className="stats-vitals-grid">
          {[
            { label: 'stars',        val: fmt(vitals.stars) },
            { label: 'forks',        val: fmt(vitals.forks) },
            { label: 'open issues',  val: fmt(vitals.openIssues) },
            { label: 'contributors', val: fmt(vitals.contributors) },
          ].map(({ label, val }) => (
            <div key={label} className="stats-vitals-cell">
              <span className="stats-vitals-val">{val}</span>
              <span className="stats-vitals-key">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="stats-divider" />

      {/* ── Health ── */}
      <section className="stats-section">
        <div className="stats-section-label">Health</div>
        <div className="stats-health-row">
          <svg width="44" height="44" viewBox="0 0 44 44" className="stats-donut">
            <circle cx="22" cy="22" r="16" fill="none" stroke="var(--bg3)" strokeWidth="5" />
            <circle
              cx="22" cy="22" r="16" fill="none"
              stroke={healthColor}
              strokeWidth="5"
              strokeDasharray={`${filled} ${circumference}`}
              strokeDashoffset={-(circumference / 4)}
              strokeLinecap="round"
            />
            <text x="22" y="26" textAnchor="middle" fill="var(--t1)" fontSize="10" fontFamily="inherit" fontWeight="bold">
              {health.score}
            </text>
          </svg>
          <div>
            <div className="stats-health-label" style={{ color: healthColor }}>
              {health.maintenance === 'active' ? 'Actively maintained' :
               health.maintenance === 'slow'   ? 'Slowing down' : 'Stale'}
            </div>
            <div className="stats-health-sub">Score out of 100</div>
          </div>
        </div>
        <div className="stats-signal-list">
          <SignalRow label="Maintenance" status={health.maintenance} />
          <SignalRow label="Issue velocity" status={health.issueVelocity} />
          <div className="stats-signal">
            <span className="stats-signal-label">Last release</span>
            <span className="stats-signal-val">
              {health.lastReleaseDate ? relativeTime(health.lastReleaseDate) : 'No releases'}
            </span>
          </div>
        </div>
      </section>

      <div className="stats-divider" />

      {/* ── Momentum ── */}
      <CollapsibleSection label="Momentum">
        {momentum === null ? (
          <div className="stats-computing">Stats computing on GitHub…</div>
        ) : (
          <>
            <div className="stats-bars">
              {(() => {
                const max = Math.max(...momentum.monthlyCommits, 1)
                return momentum.monthlyCommits.map((count, i) => (
                  <div
                    key={i}
                    className={`stats-bar${i === 5 ? ' stats-bar--current' : ''}`}
                    style={{ height: `${Math.round((count / max) * 100)}%` }}
                  />
                ))
              })()}
            </div>
            <div className="stats-trend">
              {momentum.trend === 'up' ? '↑ Trending up' :
               momentum.trend === 'down' ? '↓ Declining' : '→ Stable'}
            </div>
            <div className="stats-bars-legend">Commits/month — last 6mo</div>
          </>
        )}
      </CollapsibleSection>

      <div className="stats-divider" />

      {/* ── Security ── */}
      <CollapsibleSection label="Security">
        {!security.available ? (
          <div className="stats-computing">
            {security.permissionDenied
              ? 'Token lacks permission — grant security_events scope'
              : 'Security data not available'}
          </div>
        ) : (
          <>
            {security.vulnerabilities && totalVulns > 0 && (
              <div className="stats-vuln-row">
                <span className="stats-vuln-icon">⚠</span>
                <div>
                  <div className="stats-vuln-count">
                    {totalVulns} {totalVulns === 1 ? 'vulnerability' : 'vulnerabilities'}
                  </div>
                  <div className="stats-vuln-breakdown">
                    {security.vulnerabilities.critical}c · {security.vulnerabilities.high}h · {security.vulnerabilities.moderate}m · {security.vulnerabilities.low}l
                  </div>
                </div>
              </div>
            )}
            {security.dismissedVulnerabilities && (() => {
              const d = security.dismissedVulnerabilities!
              const dismissedTotal = d.critical + d.high + d.moderate + d.low
              return dismissedTotal > 0 ? (
                <div className="stats-vuln-dismissed">
                  <div className="stats-vuln-count" style={{ color: 'var(--t3)', fontSize: '0.82em' }}>
                    {dismissedTotal} dismissed
                  </div>
                  <div className="stats-vuln-breakdown">
                    {d.critical}c · {d.high}h · {d.moderate}m · {d.low}l
                  </div>
                </div>
              ) : null
            })()}
            {security.vulnerabilities && totalVulns === 0 && (
              <div className="stats-signal">
                <span className="stats-signal-label">Vulnerabilities</span>
                <Dot active={true} />
              </div>
            )}
            <div className="stats-signal-list">
              {security.hasSecurityPolicy !== null && (
                <div className="stats-signal">
                  <span className="stats-signal-label">Security policy</span>
                  <Dot active={security.hasSecurityPolicy} />
                </div>
              )}
              {security.codeScanning !== null && (
                <div className="stats-signal">
                  <span className="stats-signal-label">Code scanning</span>
                  {security.codeScanning === false ? (
                    <Dot active={false} />
                  ) : (() => {
                    const cs = security.codeScanning!
                    const csTotal = cs.critical + cs.high + cs.medium + cs.low + cs.note + cs.warning
                    const csHasCritical = cs.critical > 0 || cs.high > 0
                    return (
                      <span style={{ color: csHasCritical ? 'var(--red)' : 'var(--green)' }}>
                        ● {csTotal} {csTotal === 1 ? 'alert' : 'alerts'}
                      </span>
                    )
                  })()}
                </div>
              )}
              {security.secretScanning !== null && (() => {
                const ss = security.secretScanning!
                const hasActive = ss.active > 0
                return (
                  <div className="stats-signal">
                    <span className="stats-signal-label">Secret scanning</span>
                    <span style={{ color: hasActive ? 'var(--red)' : 'var(--green)' }}>
                      ● {hasActive
                        ? `${ss.active} active · ${ss.inactive} inactive · ${ss.unknown} unknown`
                        : '0 active'}
                    </span>
                  </div>
                )
              })()}
            </div>
          </>
        )}
      </CollapsibleSection>

      <div className="stats-divider" />

      {/* ── Your Engagement ── */}
      <CollapsibleSection label="Your Engagement">
        <div className="stats-signal-list">
          <div className="stats-signal">
            <span className="stats-signal-label">Starred</span>
            <span className="stats-signal-val">
              {engagement.starredAt ? relativeTime(engagement.starredAt) : '—'}
            </span>
          </div>
          <div className="stats-signal">
            <span className="stats-signal-label">Forked</span>
            <span className="stats-signal-val">
              {engagement.forkedAt ? relativeTime(engagement.forkedAt) : '—'}
            </span>
          </div>
          <div className="stats-signal">
            <span className="stats-signal-label">Skills learned</span>
            <span className="stats-signal-val">{engagement.skillsLearned}</span>
          </div>
        </div>
      </CollapsibleSection>

    </div>
  )
}

function CollapsibleSection({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="stats-section">
      <button className="stats-section-toggle" onClick={() => setOpen(o => !o)}>
        <span className="stats-section-label">{label}</span>
        <span className="stats-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && children}
    </section>
  )
}

function SignalRow({ label, status }: { label: string; status: HealthStatus | IssueVelocity }) {
  const labels: Record<string, string> = {
    active: 'Active', slow: 'Slow', stale: 'Stale',
    healthy: 'Healthy', backlogged: 'Backlogged', critical: 'Critical',
  }
  return (
    <div className="stats-signal">
      <span className="stats-signal-label">{label}</span>
      <span className="stats-signal-status" style={{ color: STATUS_COLOR[status] }}>
        ● {labels[status]}
      </span>
    </div>
  )
}

function Dot({ active }: { active: boolean }) {
  return (
    <span style={{ color: active ? 'var(--green)' : 'var(--red)' }}>
      ● {active ? 'Present' : 'Absent'}
    </span>
  )
}
