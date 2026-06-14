import { useCompare } from '../hooks/useCompare'
import './CompareSummary.css'

interface Props {
  hostId: string
  owner: string
  repo: string
  // Either a real base ref (compare) or null when this is a first-release
  // ("commits/<head>") link with no prior tag to diff against.
  base: string | null
  head: string
}

function fileStatusLabel(status: string): string {
  switch (status) {
    case 'added':    return 'A'
    case 'removed':  return 'D'
    case 'modified': return 'M'
    case 'renamed':  return 'R'
    default:         return status[0]?.toUpperCase() ?? '?'
  }
}

export function CompareSummary({ hostId, owner, repo, base, head }: Props) {
  // First release: no compare to fetch, just show a "first release" pill
  // linking to the commits page.
  if (base === null) {
    const url = `https://github.com/${owner}/${repo}/commits/${encodeURIComponent(head)}`
    return (
      <a className="compare-summary compare-summary--first" href={url} target="_blank" rel="noreferrer">
        <span className="compare-summary__refs">
          <span className="compare-summary__ref compare-summary__ref--head">{head}</span>
          <span className="compare-summary__first-pill">first release</span>
        </span>
      </a>
    )
  }

  return <CompareSummaryFetched hostId={hostId} owner={owner} repo={repo} base={base} head={head} />
}

function CompareSummaryFetched({ hostId, owner, repo, base, head }: { hostId: string; owner: string; repo: string; base: string; head: string }) {
  const { data, loading, error } = useCompare(hostId, owner, repo, base, head)
  const fallbackUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`

  if (loading) {
    return (
      <div className="compare-summary compare-summary--skeleton" aria-busy="true">
        <span className="compare-summary__refs">
          <span className="compare-summary__ref">{base}</span>
          <span className="compare-summary__arrow">→</span>
          <span className="compare-summary__ref compare-summary__ref--head">{head}</span>
        </span>
        <span className="compare-summary__skeleton-stats" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <a className="compare-summary compare-summary--error" href={fallbackUrl} target="_blank" rel="noreferrer">
        <span className="compare-summary__refs">
          <span className="compare-summary__ref">{base}</span>
          <span className="compare-summary__arrow">→</span>
          <span className="compare-summary__ref compare-summary__ref--head">{head}</span>
        </span>
        <span className="compare-summary__hint">View changelog on GitHub</span>
      </a>
    )
  }

  return (
    <a className="compare-summary" href={data.htmlUrl} target="_blank" rel="noreferrer">
      <div className="compare-summary__top">
        <span className="compare-summary__refs">
          <span className="compare-summary__ref">{data.base}</span>
          <span className="compare-summary__arrow">→</span>
          <span className="compare-summary__ref compare-summary__ref--head">{data.head}</span>
        </span>
        <span className="compare-summary__stats">
          <span className="compare-summary__stat">
            <strong>{data.totalCommits}</strong> {data.totalCommits === 1 ? 'commit' : 'commits'}
          </span>
          <span className="compare-summary__stat">
            <strong>{data.filesChanged}</strong> {data.filesChanged === 1 ? 'file' : 'files'}
          </span>
          {(data.additions > 0 || data.deletions > 0) && (
            <span className="compare-summary__stat compare-summary__diff">
              <span className="compare-summary__add">+{data.additions.toLocaleString()}</span>
              <span className="compare-summary__del">−{data.deletions.toLocaleString()}</span>
            </span>
          )}
        </span>
      </div>

      {data.topFiles.length > 0 && (
        <ul className="compare-summary__files">
          {data.topFiles.map(f => (
            <li key={f.filename} className="compare-summary__file">
              <span className={`compare-summary__file-status compare-summary__file-status--${f.status}`}>
                {fileStatusLabel(f.status)}
              </span>
              <span className="compare-summary__file-name">{f.filename}</span>
              <span className="compare-summary__file-diff">
                <span className="compare-summary__add">+{f.additions}</span>
                <span className="compare-summary__del">−{f.deletions}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.topAuthors.length > 0 && (
        <div className="compare-summary__authors">
          <span className="compare-summary__authors-label">By</span>
          {data.topAuthors.map(a => (
            <span key={a.login} className="compare-summary__author" title={`${a.login} (${a.commits} ${a.commits === 1 ? 'commit' : 'commits'})`}>
              <img src={a.avatarUrl} alt={a.login} />
            </span>
          ))}
        </div>
      )}
    </a>
  )
}
