import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/protocol'
import type { ContextTarget } from '../../shared/commands'
import { keyOf } from '../../shared/forks'
import { Fold } from './Fold'
import { ForkIcon } from './ForkIcon'
import { PopMenu, type PopItem } from './PopMenu'

interface Props {
  sessions: SessionSummary[]
  openId: string | undefined
  /** Which sessions came out of another one, by `directory/id`. */
  forked: ReadonlySet<string>
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
function contextMenu(target: ContextTarget, id: string) {
  return (event: React.MouseEvent): void => {
    event.preventDefault()
    window.bravebot.popupContext({ target, id })
  }
}

/**
 * The left-hand column: one list across every project, newest first.
 *
 * Flat by default, because this is a chat list and a chat list has one column. The project
 * is the secondary line, the way a group chat names itself under the message. But a flat
 * list cannot answer "what have I been doing in *this* checkout" without typing the project
 * name, so the toggle beside the filter box gathers the same rows under headings instead.
 *
 * Both are rendering decisions over what is already here rather than questions for the
 * bridge: `session.list` hands over every session at once, with the directory on each, so a
 * round trip would only make this slower and able to fail.
 */
export { contextMenu }

export function Sessions({
  sessions,
  openId,
  forked,
  onOpen,
  onNew,
  build,
}: Props): React.JSX.Element {
  // Local rather than lifted into `App`. The convention there is that state lives in `App`,
  // but the reason given for the composer's draft is that the menu has to read it; nothing
  // outside this column reads the query, and — more to the point — `App` looks a right-
  // clicked session up in `sessions` by id. Filtering a copy it holds would make a menu item
  // fail on a row that is hidden a moment later.
  const [query, setQuery] = useState('')
  const shown = useMemo(() => matching(sessions, query), [sessions, query])

  // Unlike the query, this is remembered between launches: which way somebody likes their
  // list is not a per-run thought. The stored value arrives asynchronously and so cannot
  // seed `useState` — the same dance `columns.ts` documents — which is why the column
  // renders flat for a frame before adopting it. `ready` keeps that first frame from
  // writing the default back over what is on disk.
  const [grouped, setGrouped] = useState(false)
  // Which groups are shut, by directory. The shut ones rather than the open ones, so a
  // checkout that appears while the app is running arrives open rather than hidden.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const ready = useRef(false)
  useEffect(() => {
    void window.bravebot
      .readView()
      .then((view) => {
        setGrouped(view.grouped)
        setCollapsed(new Set(view.collapsed))
      })
      .catch(() => undefined)
      .finally(() => (ready.current = true))
  }, [])
  useEffect(() => {
    if (!ready.current) return
    try {
      window.bravebot.writeView({ grouped, collapsed: [...collapsed] })
    } catch {
      // The list is still arranged the way it was asked to be, this session.
    }
  }, [grouped, collapsed])

  const toggleGroup = useCallback((directory: string) => {
    setCollapsed((was) => {
      const next = new Set(was)
      if (!next.delete(directory)) next.add(directory)
      return next
    })
  }, [])

  const groups = useMemo(() => (grouped ? grouping(shown) : []), [grouped, shown])

  // A live query opens every group for as long as it runs. A person who typed something and
  // got a heading with nothing under it has been shown the opposite of what they asked for,
  // and quietly reopening beats making them undo a fold they set days ago — which is why
  // this reads through `collapsed` rather than clearing it.
  const searching = query.trim().length > 0

  return (
    <aside className="sessions" id="sessions-column">
      <header className="sessions-head">
        <NewSession onNew={onNew} />
        <div className="session-tools">
          <input
            type="search"
            className="session-find"
            value={query}
            placeholder="Filter sessions"
            aria-label="Filter sessions"
            // The placeholder says what the box is; the tooltip says the one thing about it
            // that is not on screen anywhere. Escape is deliberately not in the menu — see
            // the note on the handler below — so without this it is a key nobody finds.
            title="Filter sessions · Escape clears it"
            onChange={(event) => setQuery(event.target.value)}
            // Escape clears rather than blurs, and is handled here rather than as a command:
            // an accelerator would be swallowed by AppKit before the renderer saw it, and the
            // composer already treats Escape as a local key.
            onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
          />
          {/* The label stays put and `aria-pressed` carries the state, with the verb in the
              tooltip — the same disclosure discipline the column folds follow. A control
              that renamed itself would be one the reader has to re-find after every press. */}
          <button
            className="session-group"
            aria-pressed={grouped}
            aria-label="Group by project"
            title={grouped ? 'Show one flat list' : 'Group by project'}
            onClick={() => setGrouped(!grouped)}
          >
            <span aria-hidden="true">▤</span>
          </button>
        </div>
      </header>

      <div className="session-list">
        {sessions.length === 0 && (
          <p className="empty">
            No sessions yet. Open a project to begin — or start one in a terminal with{' '}
            <code>bravebot</code> and it will appear here.
          </p>
        )}
        {/* Said separately, because the message above is a fact about the machine and would
            be a lie about a list that is merely filtered down to nothing. */}
        {sessions.length > 0 && shown.length === 0 && (
          <p className="empty">No session matches “{query}”.</p>
        )}
        {!grouped &&
          shown.map((session) => (
            <Session
              key={`${session.directory}/${session.id}`}
              session={session}
              openId={openId}
              forked={forked.has(keyOf(session.directory, session.id))}
              onOpen={onOpen}
            />
          ))}
        {grouped &&
          groups.map((group) => (
            <Group
              key={group.directory}
              group={group}
              open={searching || !collapsed.has(group.directory)}
              onToggle={toggleGroup}
              openId={openId}
              forked={forked}
              onOpen={onOpen}
              onNew={onNew}
            />
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
 * One checkout's sessions, under a heading that opens and shuts them.
 *
 * Most of the heading is the disclosure control rather than a chevron beside it: the name is
 * the biggest thing in reach, and a group that can be folded should not ask for a 10px arrow
 * to be hit. `aria-expanded` carries the state and the name stays put — the disclosure
 * discipline the column folds and the context panels already follow.
 *
 * The heading is a row of two buttons rather than one, because the second one starts a
 * session here and a button cannot be nested inside a button. That is also why the fold is
 * the *inner* control: making the row itself clickable and the plus a child would have been
 * the nesting problem wearing a different hat.
 *
 * The rows stay mounted while shut, because that is how [`Fold`] has something to animate
 * away from; it hides them from the reader and from the tab order in CSS once the collapse
 * has finished.
 */
function Group({
  group,
  open,
  onToggle,
  openId,
  forked,
  onOpen,
  onNew,
}: {
  group: Group
  open: boolean
  onToggle: (directory: string) => void
  openId: string | undefined
  forked: ReadonlySet<string>
  onOpen: (summary: SessionSummary) => void
  onNew: (directory: string) => void
}): React.JSX.Element {
  return (
    <section className="session-group-section">
      {/* The full path in the tooltip, because two checkouts of one project share a basename
          and picking the wrong one is a mistake nothing later announces — the same trap the
          recents menu guards against. On both buttons: the one that starts a session here is
          exactly where that mistake would cost something. */}
      <div className="session-group-head">
        <button
          className="session-group-fold"
          aria-expanded={open}
          title={group.directory}
          onClick={() => onToggle(group.directory)}
        >
          <span className={`chevron ${open ? 'open' : ''}`} aria-hidden="true">
            ›
          </span>
          <span className="session-group-name">{group.project}</span>
          <span className="count">{group.sessions.length}</span>
        </button>
        {/* The same thing **New session** does, minus the folder picker — the directory is
            already known, and the picker's whole job is to find one out. Named for the
            project rather than "New session" so that a reader of the button list is told
            which of a dozen identical-looking pluses they have landed on. */}
        <button
          className="session-group-new"
          aria-label={`New session in ${group.project}`}
          title={`New session in ${group.directory}`}
          onClick={() => onNew(group.directory)}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <Fold open={open}>
        {group.sessions.map((session) => (
          <Session
            key={`${session.directory}/${session.id}`}
            session={session}
            openId={openId}
            forked={forked.has(keyOf(session.directory, session.id))}
            onOpen={onOpen}
          />
        ))}
      </Fold>
    </section>
  )
}

/**
 * One row, whichever arrangement it is standing in.
 *
 * The same component under a heading as in the flat list, so the two paths cannot drift into
 * showing different things about a session. The project stays on the row even when the
 * heading above already says it: the row is what a person reads, and a row that means
 * something different depending on how far up the list they last looked is worse than a
 * word repeated.
 */
function Session({
  session,
  openId,
  forked,
  onOpen,
}: {
  session: SessionSummary
  openId: string | undefined
  forked: boolean
  onOpen: (summary: SessionSummary) => void
}): React.JSX.Element {
  return (
    <button
      className={`session ${session.id === openId ? 'current' : ''}`}
      onClick={() => onOpen(session)}
      onContextMenu={contextMenu('session', session.id)}
    >
      {/* What the column clipped, not the prompt it came from: the agent shortens a title
          to 60 characters and an ellipsis of its own before it is ever stored, and this
          cannot get back what was dropped there. It gets back what the column dropped on
          top of that, which at this width is most of it — and two sessions in a project
          often differ only in the part that gets cut. The mark is left out of it: it is
          said in words beside the glyph, and a tooltip is for what the column clipped. */}
      {/* The word the glyph stands in for, said to a reader who does not see glyphs. Outside
          the title and not inside it: `.offscreen` is taken out of the flow, so this costs
          the layout nothing wherever it sits — and inside, it would be part of what the
          title element *says*, which is a session's name and nothing else. */}
      {forked && <span className="offscreen">Forked. </span>}
      <span className="session-title" title={session.title}>
        {/* Before the name rather than after it, so the marks line up down the column
            instead of hanging off titles of every length. */}
        {forked && (
          <span className="fork-mark">
            <ForkIcon size={11} />
          </span>
        )}
        {session.title}
      </span>
      <span className="session-where">
        {session.project}
        {session.branch && <span className="branch"> · {session.branch}</span>}
        <span className="when"> · {ago(session.updated)}</span>
      </span>
    </button>
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
 * The sessions a typed query leaves standing.
 *
 * Matched against exactly what a row shows — title, project, branch — so a person can always
 * see why something is in the list. The directory is deliberately not in the haystack even
 * though every session carries one: `project` is its last segment, and searching the whole
 * path would mean every checkout under `~/repos` answered to "repos".
 *
 * Every whitespace-separated term has to appear somewhere, in any order. Plain substrings
 * rather than a fuzzy score: a fuzzy match on a list this short mostly buys the right to
 * return rows the reader cannot account for.
 */
function matching(sessions: SessionSummary[], query: string): SessionSummary[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return sessions
  return sessions.filter((session) => {
    const haystack = `${session.title} ${session.project} ${session.branch ?? ''}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

interface Group {
  directory: string
  project: string
  sessions: SessionSummary[]
}

/**
 * The same sessions, gathered under the checkout each was started in.
 *
 * Keyed on `directory` rather than `project`, because two checkouts of one repository share
 * a basename and folding them together would put work from one under a heading that means
 * the other.
 *
 * Nothing is sorted. The list arrives newest-first across every project, so one pass in
 * order leaves the rows in each group newest-first and the groups themselves in the order
 * their newest session appeared — which is the ordering we want, arrived at by not
 * disturbing the one we were given. Imposing it separately would be a second opinion about
 * recency, free to disagree with the bridge's.
 *
 * Grouping happens after filtering, so a group whose every row was filtered away has no
 * heading left behind to say otherwise.
 */
function grouping(sessions: SessionSummary[]): Group[] {
  const groups = new Map<string, Group>()
  for (const session of sessions) {
    const group = groups.get(session.directory)
    if (group) group.sessions.push(session)
    else {
      groups.set(session.directory, {
        directory: session.directory,
        project: session.project,
        sessions: [session],
      })
    }
  }
  return [...groups.values()]
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
