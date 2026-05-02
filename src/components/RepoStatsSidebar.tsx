// src/components/RepoStatsSidebar.tsx
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

export function RepoStatsSidebar({ stats }: Props) {
  if (stats === 'loading') return <div className="stats-sidebar-loading" />
  if (stats === 'error')   return <div className="stats-sidebar-error">Failed to load stats.</div>

  const { vitals, health, momentum, security, engagement } = stats
  const totalVulns = security.vulnerabilities
    ? security.vulnerabilities.high + security.vulnerabilities.moderate + security.vulnerabilities.low
    : 0

  const healthColor = health.score >= 70 ? 'var(--green)' : health.score >= 40 ? 'var(--yellow)' : 'var(--red)'
  const circumference = 2 * Math.PI * 16
  const filled = (health.score / 100) * circumference

  return (
    <div className="stats-sidebar-enriched">

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
      <section className="stats-section">
        <div className="stats-section-label">Momentum</div>
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
      </section>

      <div className="stats-divider" />

      {/* ── Security ── */}
      <section className="stats-section">
        <div className="stats-section-label">Security</div>
        {!security.available ? (
          <div className="stats-computing">Security data not available</div>
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
                    {security.vulnerabilities.high}h · {security.vulnerabilities.moderate}m · {security.vulnerabilities.low}l
                  </div>
                </div>
              </div>
            )}
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
              {security.codeScanningEnabled !== null && (
                <div className="stats-signal">
                  <span className="stats-signal-label">Code scanning</span>
                  <Dot active={security.codeScanningEnabled} />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <div className="stats-divider" />

      {/* ── Your Engagement ── */}
      <section className="stats-section">
        <div className="stats-section-label">Your Engagement</div>
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
      </section>

    </div>
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
