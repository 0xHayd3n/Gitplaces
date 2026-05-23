import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useGitHubAuth } from '../contexts/GitHubAuth'
import { useFeed, type GitHubFeedEvent } from '../hooks/useFeed'
import ActivityEvent from './ActivityEvent'
import { DateDivider } from './DateDivider'
import { ActivityModal } from './ActivityModal'
import { groupEventsByDay } from '../utils/groupEventsByDay'
import './ActivityFeed.css'

const PULL_THRESHOLD = 70
const PULL_MAX = 110
const PULL_DAMPING = 0.5
const LOADING_INDICATOR_HEIGHT = 36

export default function ActivityFeed() {
  const { user } = useGitHubAuth()
  const { events, loading, error, refresh } = useFeed()
  const [selectedEvent, setSelectedEvent] = useState<GitHubFeedEvent | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pullRef = useRef(0)
  const triggeredRef = useRef(false)
  const location = useLocation()
  const navigate = useNavigate()

  // Track event IDs from the prior render so we can animate items that appear
  // when a fetch merges fresher entries in on top of the cached list. `null`
  // on the very first render means cached items render statically — they were
  // already there last session, so they shouldn't appear to "arrive".
  const prevIdsRef = useRef<Set<string> | null>(null)
  const prevIds = prevIdsRef.current
  const freshIds = new Set<string>()
  if (prevIds !== null) {
    for (const e of events) {
      if (!prevIds.has(e.id)) freshIds.add(e.id)
    }
  }
  useEffect(() => {
    prevIdsRef.current = new Set(events.map(e => e.id))
  }, [events])

  // Re-arm pull gesture once a pull-triggered refresh completes.
  useEffect(() => {
    if (!loading && triggeredRef.current) triggeredRef.current = false
  }, [loading])

  // Restore the modal when the user navigates back from a repo opened via the
  // modal's repo pill. The pill stashed the event id on this route's history
  // entry; re-opening with that id puts the user back at the same scroll
  // context (the modal slices from initialEventId onward).
  useEffect(() => {
    const eventId = (location.state as { fromModalEventId?: string } | null)?.fromModalEventId
    if (!eventId) return
    const event = events.find(e => e.id === eventId)
    if (!event) return
    setSelectedEvent(event)
    navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location.state, location.pathname, location.search, events, navigate])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return

    let decayTimer: ReturnType<typeof setTimeout> | undefined
    const setPull = (n: number) => {
      pullRef.current = n
      setPullDistance(n)
    }

    const onWheel = (e: WheelEvent) => {
      if (triggeredRef.current) return
      if (el.scrollTop > 0) {
        if (pullRef.current > 0) setPull(0)
        return
      }
      if (e.deltaY < 0) {
        e.preventDefault()
        const next = Math.min(pullRef.current - e.deltaY * PULL_DAMPING, PULL_MAX)
        setPull(next)
        if (decayTimer) clearTimeout(decayTimer)
        if (next >= PULL_THRESHOLD) {
          triggeredRef.current = true
          refresh()
          setPull(0)
        } else {
          // user paused mid-pull → retract after a short idle
          decayTimer = setTimeout(() => setPull(0), 220)
        }
      } else if (e.deltaY > 0 && pullRef.current > 0) {
        e.preventDefault()
        setPull(Math.max(0, pullRef.current - e.deltaY))
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (decayTimer) clearTimeout(decayTimer)
    }
  }, [refresh])

  if (!user) {
    return (
      <div className="activity-feed activity-feed--empty">
        <p className="activity-feed-msg">Connect your GitHub account to see your activity</p>
      </div>
    )
  }

  const groups = groupEventsByDay(events)
  const showLoadingSpinner = loading && triggeredRef.current
  const indicatorHeight = showLoadingSpinner ? LOADING_INDICATOR_HEIGHT : pullDistance
  const indicatorProgress = Math.min(pullDistance / PULL_THRESHOLD, 1)

  return (
    <div className="activity-feed">
      <div ref={bodyRef} className="activity-feed-body">
        <div
          className={[
            'activity-feed-pull',
            // Smooth transition only when retracting to 0 or in loading state — during
            // active pull, height must track the wheel exactly without animation lag.
            (pullDistance === 0 || showLoadingSpinner) ? 'activity-feed-pull--smooth' : '',
            showLoadingSpinner ? 'activity-feed-pull--spinning' : '',
          ].filter(Boolean).join(' ')}
          style={{ height: indicatorHeight, opacity: showLoadingSpinner ? 1 : indicatorProgress }}
        >
          <RefreshCw
            size={15}
            style={showLoadingSpinner ? undefined : { transform: `rotate(${pullDistance * 3}deg)` }}
          />
        </div>

        {loading && events.length === 0 && !triggeredRef.current && (
          <div className="activity-feed-skeletons">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="activity-event-skeleton" />
            ))}
          </div>
        )}

        {!loading && error && events.length === 0 && (
          <p className="activity-feed-msg activity-feed-msg--error">{error}</p>
        )}

        {!loading && !error && events.length === 0 && (
          <p className="activity-feed-msg">Nothing in your network yet</p>
        )}

        {groups.map(group => (
          <div key={group.label}>
            <DateDivider label={group.label} />
            {group.events.map(event => (
              <div
                key={event.id}
                className={
                  freshIds.has(event.id)
                    ? 'activity-event-wrapper activity-event-wrapper--fresh'
                    : 'activity-event-wrapper'
                }
              >
                <ActivityEvent
                  event={event}
                  onOpenModal={setSelectedEvent}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {selectedEvent && (
        <ActivityModal
          events={events}
          initialEventId={selectedEvent.id}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}
