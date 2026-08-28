import { useCallback, useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/protocol'
import { PopMenu, type PopItem } from './PopMenu'

interface Props {
  sessions: SessionSummary[]
  openId: string | undefined
  onOpen: (summary: SessionSummary) => void
  onNew: (directory?: string) => void
  build: string | null
}

/**
 * Ask the main process for the menu that belongs to a thing here.
 *
 * Only the kind and the id travel. What the menu says is decided over there, from labels
 * compiled into it, so nothing on screen can put a word into a native menu.
 */
function contextMenu(target: 'session' | 'entry', id: string) {
  return (event: React.MouseEvent): void => {
    event.preventDefault()
    window.bravebot.popupContext({ target, id })
  }
}

/**
 * The left-hand column: one flat list across every project, newest first.
 *
 * Flat rather than grouped by checkout, because this is a chat list and a chat list has
 * one column. The project is the secondary line, the way a group chat names itself under
 * the message.
 */
export { contextMenu }

export function Sessions({ sessions, openId, onOpen, onNew, build }: Props): React.JSX.Element {
  return (
    <aside className="sessions" id="sessions-column">
      <header className="sessions-head">
        <NewSession onNew={onNew} />
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
            onContextMenu={contextMenu('session', session.id)}
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
 * The button that starts a session, and the list of places to start one in.
 *
 * A split control: the button itself does exactly what it always did — opens the folder
 * picker — and the chevron beside it offers the projects opened before. Anything else would
 * have made the common case slower to reach in order to make the second case possible.
 */
function NewSession({ onNew }: { onNew: (directory?: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [directories, setDirectories] = useState<string[]>([])
  const chevron = useRef<HTMLButtonElement>(null)

  // Read when the menu is opened rather than held and kept in step: the list changes in the
  // main process, and a copy up here would be one more thing that can be stale.
  const show = useCallback(() => {
    void window.bravebot.readRecents().then((found) => {
      setDirectories(found)
      setOpen(true)
    })
  }, [])

  const items: PopItem[] = directories.length
    ? directories.map((directory) => ({
        id: directory,
        label: directory.split('/').pop() || directory,
        // Two checkouts of one project share a basename, and picking the wrong one is a
        // mistake nothing later would announce.
        detail: directory,
      }))
    : [{ id: 'none', label: 'No projects opened yet', enabled: false }]

  return (
    <div className="new-split">
      <button className="new" onClick={() => onNew()} title="Open a project">
        <span className="plus">+</span> New session
      </button>
      <button
        ref={chevron}
        className="new-recent"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Projects opened before"
        title="Projects opened before"
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span aria-hidden="true">⌄</span>
      </button>
      <PopMenu
        open={open}
        anchor={chevron}
        items={items}
        label="Projects opened before"
        onChoose={(id) => onNew(id)}
        onClose={() => setOpen(false)}
      />
    </div>
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
