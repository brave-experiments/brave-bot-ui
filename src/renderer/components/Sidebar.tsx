/**
 * The left column, the choice of which list is in it, and what it remembers about both.
 *
 * ## Why the hidden one stays mounted
 *
 * Switching tabs hides a list with `display: none` rather than unmounting it, which is the rule
 * the context panels already follow and for the same reason: a filter somebody typed, a group they
 * folded, a row they scrolled to are all things that should survive looking at something else for
 * a moment. A column that forgot them would make the tabs cost something to press.
 *
 * ## Why what is remembered lives here
 *
 * The grouping and the folds were the session list's own, since nothing else read them and the
 * convention in this window is that state lives where it is used. This lifts them one level, and
 * the reason is not that anything else reads them today — it is that they are written to *disk*,
 * under a single key, and a key with more than one writer is a race waiting for a second one to
 * arrive. One component reading and writing the whole of `view` is one write.
 *
 * That leaves `Sessions` holding only what is nobody else's business — the search box, the row it
 * has scrolled to — which is the line this draws: what survives a relaunch is the column's, and
 * what lasts as long as looking at it is the list's.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/protocol'
import type { Tab } from '../../shared/view'
import { Sessions } from './Sessions'

interface Props {
  sessions: SessionSummary[]
  openId: string | undefined
  forked: ReadonlySet<string>
  onOpen: (summary: SessionSummary) => void
  onNew: (directory?: string) => void
  build: string | null
}

export function Sidebar({
  sessions,
  openId,
  forked,
  onOpen,
  onNew,
  build,
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('sessions')
  const [grouped, setGrouped] = useState(false)
  // Which groups are shut, by directory. The shut ones rather than the open ones, so a checkout
  // that appears while the app is running arrives open rather than hidden.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  // The stored value arrives asynchronously and so cannot seed `useState` — the same dance
  // `columns.ts` documents — which is why the column renders flat for a frame before adopting
  // whatever was left. `ready` keeps that first frame from writing the default back over what is
  // on disk.
  const ready = useRef(false)
  useEffect(() => {
    void window.bravebot
      .readView()
      .then((view) => {
        setTab(view.tab)
        setGrouped(view.grouped)
        setCollapsed(new Set(view.collapsed))
      })
      .catch(() => undefined)
      .finally(() => (ready.current = true))
  }, [])
  useEffect(() => {
    if (!ready.current) return
    try {
      window.bravebot.writeView({ tab, grouped, collapsed: [...collapsed] })
    } catch {
      // The column is still arranged the way it was asked to be, this session.
    }
  }, [tab, grouped, collapsed])

  const show = useCallback((next: Tab) => setTab(next), [])

  return (
    <aside className="sessions" id="sessions-column">
      {/* The label stays put and `aria-pressed` carries which is on, the disclosure discipline
          every toggle in this window follows. No tooltips: the labels are the whole of what
          these do, and a popup could only repeat them. */}
      <div className="sidebar-tabs" role="group" aria-label="What the column shows">
        <button
          className="sidebar-tab"
          aria-pressed={tab === 'sessions'}
          onClick={() => show('sessions')}
        >
          Sessions
        </button>
        <button className="sidebar-tab" aria-pressed={tab === 'bots'} onClick={() => show('bots')}>
          Bots
        </button>
      </div>

      <div className="sidebar-body" hidden={tab !== 'sessions'}>
        <Sessions
        sessions={sessions}
        openId={openId}
        forked={forked}
        onOpen={onOpen}
        onNew={onNew}
        grouped={grouped}
        onGroup={setGrouped}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        />
      </div>

      {/* Empty until there is something to put in it. The tab is here now because the column's
          shape — two bodies under one head, and which one is remembered — is the part that every
          driver and every stylesheet rule has to agree about. */}
      <div className="sidebar-body" hidden={tab !== 'bots'} />

      {build && (
        <footer className="build" title="The agent build these sessions are stamped with">
          {build}
        </footer>
      )}
    </aside>
  )
}
