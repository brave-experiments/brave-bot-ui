import type { SessionSummary } from '../../shared/protocol'

interface Props {
  sessions: SessionSummary[]
  openId: string | undefined
  onOpen: (summary: SessionSummary) => void
  onNew: () => void
  build: string | null
}

/**
 * The left-hand column: one flat list across every project, newest first.
 *
 * Flat rather than grouped by checkout, because this is a chat list and a chat list has
 * one column. The project is the secondary line, the way a group chat names itself under
 * the message.
 */
export function Sessions({ sessions, openId, onOpen, onNew, build }: Props): React.JSX.Element {
  return (
    <aside className="sessions" id="sessions-column">
      <header className="sessions-head">
        <button className="new" onClick={onNew} title="Open a project">
          <span className="plus">+</span> New session
        </button>
      </header>

      <div className="session-list">
        {sessions.length === 0 && (
          <p className="empty">
            No sessions yet. Open a project to begin — or start one in a terminal with{' '}
            <code>bravebot</code> and it will appear here.
          </p>
        )}
        {sessions.map((session) => (
          <button
            key={`${session.directory}/${session.id}`}
            className={`session ${session.id === openId ? 'current' : ''}`}
            onClick={() => onOpen(session)}
          >
            <span className="session-title">{session.title}</span>
            <span className="session-where">
              {session.project}
              {session.branch && <span className="branch"> · {session.branch}</span>}
              <span className="when"> · {ago(session.updated)}</span>
            </span>
          </button>
        ))}
      </div>

      {build && (
        <footer className="build" title="The agent build these sessions are stamped with">
          {build}
        </footer>
      )}
    </aside>
  )
}

/**
 * How long ago, in the words a person says it in.
 *
 * Deliberately the same thresholds as the agent's own `how_long_ago`, so a session does
 * not read as "2 hours ago" here and "1 hour ago" in the terminal.
 */
function ago(then: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - then)
  if (seconds < 60) return 'just now'
  const [count, unit] =
    seconds < 3600
      ? [Math.floor(seconds / 60), 'minute']
      : seconds < 86400
        ? [Math.floor(seconds / 3600), 'hour']
        : seconds < 2592000
          ? [Math.floor(seconds / 86400), 'day']
          : [Math.floor(seconds / 2592000), 'month']
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}
