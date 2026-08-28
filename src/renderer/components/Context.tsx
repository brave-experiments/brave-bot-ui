import { useState } from 'react'
import { Fold } from './Fold'
import type { Activity, Phase, Shown, TodoRow } from '../../shared/protocol'
import type { Entry } from '../transcript'

interface Live {
  entries: Entry[]
  todos: TodoRow[]
  quarantine: Shown[]
  phase: Phase | null
  tokens: number
  running: boolean
}

/**
 * The right-hand column: what this session has touched.
 *
 * Derived from the transcript rather than tracked separately, so the two cannot disagree
 * about what happened.
 */
export function Context({ live }: { live: Live | null }): React.JSX.Element {
  if (!live) return <aside className="context" id="context-column" />

  const files = touched(live.entries)
  const writes = written(live.entries)
  const replayed = live.entries.filter((entry) => entry.kind === 'replayed-tool')

  // A session read back off disk has calls in its transcript and nothing behind them:
  // the record keeps what a turn did, not what came of it. Saying "nothing read yet"
  // under a transcript that plainly shows a read is worse than saying nothing — it is
  // the interface contradicting itself. So the two cases are distinguished, and the
  // replayed one says what it actually knows.
  const onlyReplayed = replayed.length > 0 && files.length === 0

  return (
    <aside className="context" id="context-column">
      <Section title="Plan" count={live.todos.length}>
        {live.todos.length === 0 ? (
          <p className="none">{onlyReplayed ? 'No plan was recorded.' : 'No plan yet.'}</p>
        ) : (
          <ul className="todos">
            {live.todos.map((row, index) => (
              <li key={index} className={row.status}>
                <span className="marker">
                  {row.status === 'done' ? '✓' : row.status === 'active' ? '▸' : '·'}
                </span>
                {row.content}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Named for what it actually holds. Live, these are files and whether the planner
          was allowed to read them. Replayed, they are every call the turn made — reads,
          writes and processors alike — because that is all the record kept. Calling that
          list "files read" would be a third thing the interface got wrong about a session
          it did not watch. */}
      <Section
        title={onlyReplayed ? 'Calls made' : 'Files read'}
        count={onlyReplayed ? replayed.length : files.length}
      >
        {onlyReplayed ? (
          <>
            <p className="none">
              From the record. It keeps what each turn did, not what came of it, so
              there is nothing to say about where these landed.
            </p>
            <ul className="files">
              {replayed.map((entry) =>
                entry.kind === 'replayed-tool' ? (
                  <li key={entry.id} className="from-record">
                    <code>{entry.text}</code>
                  </li>
                ) : null,
              )}
            </ul>
          </>
        ) : files.length === 0 ? (
          <p className="none">Nothing read yet.</p>
        ) : (
          <ul className="files">
            {files.map((file) => (
              <li key={file.target} className={file.confined ? 'confined' : ''}>
                <code>{file.target}</code>
                {file.confined && <span className="tag">confined</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Writes" count={writes.length}>
        {writes.length === 0 ? (
          <p className="none">
            {onlyReplayed
              ? 'Not recorded for past turns.'
              : 'Nothing has been written.'}
          </p>
        ) : (
          <ul className="files">
            {writes.map((write) => (
              <li key={write.target} className={write.state}>
                <code>{write.target}</code>
                <span className="tag">{write.state}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Confined content" count={live.quarantine.length}>
        {live.quarantine.length === 0 ? (
          <p className="none">
            {onlyReplayed
              ? 'Not recorded for past turns. Confined content is never written down.'
              : 'Nothing confined.'}
          </p>
        ) : (
          <ul className="confined-list">
            {live.quarantine.map((shown, index) => (
              <li key={index}>
                <div className="origin">{shown.origin}</div>
                <div className="detail">
                  {shown.lines} line{shown.lines === 1 ? '' : 's'} · {shown.label}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <section className="panel">
      <button className="panel-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? 'open' : ''}`}>›</span>
        {title}
        {count > 0 && <span className="count">{count}</span>}
      </button>
      <Fold open={open} className="panel-inner">
        {children}
      </Fold>
    </section>
  )
}

/**
 * Which files the turn opened, and whether the planner was allowed to read them.
 *
 * The distinction is the whole point of the tool, so it is carried into the list rather
 * than flattened into "files". A name here does not mean the model saw the contents.
 */
function touched(entries: Entry[]): { target: string; confined: boolean }[] {
  const seen = new Map<string, boolean>()
  for (const entry of entries) {
    if (entry.kind !== 'tool' || !entry.activity.target) continue
    if (entry.activity.failed) continue
    // A file the turn wrote is not a file it read. It has its own panel, and naming it
    // here as well told the reader the model had seen contents it never opened.
    if (isWrite(entry.activity)) continue
    const confined = entry.landing !== null && entry.landing !== 'context'
    // Once confined, always shown as confined: a file read into quarantine and later
    // named again should not lose the mark.
    seen.set(entry.activity.target, (seen.get(entry.activity.target) ?? false) || confined)
  }
  return [...seen].map(([target, confined]) => ({ target, confined }))
}

/** One file the turn wrote, and how far that write got. */
interface Write {
  target: string
  state: 'applied' | 'refused' | 'waiting'
}

/**
 * What the turn wrote.
 *
 * A write reaches this column two ways: as a confirmation somebody answered, and as the
 * call itself. Only the first was read here, so a write that needed no confirmation — a
 * path already approved, a session running without prompts — left the panel saying
 * nothing had been written underneath a transcript plainly showing a write. Both are read
 * now, and merged by path so a confirmed write is one row rather than two.
 */
function written(entries: Entry[]): Write[] {
  const rows = new Map<string, Write>()
  for (const entry of entries) {
    if (entry.kind === 'confirm') {
      rows.set(entry.request.path, {
        target: entry.request.path,
        state:
          entry.decision === 'approve'
            ? 'applied'
            : entry.decision === 'reject'
              ? 'refused'
              : 'waiting',
      })
      continue
    }
    if (entry.kind !== 'tool' || !isWrite(entry.activity) || !entry.activity.target) continue
    // A call still running has not changed anything yet, and a refused or failed one never
    // will. Neither may read as "applied".
    const state = entry.activity.failed
      ? 'refused'
      : entry.activity.note === null
        ? 'waiting'
        : 'applied'
    // An outcome already recorded for this path — a decision, or the finish of the same
    // call — outranks a line that has not finished, so a pending row cannot overwrite it.
    if (state === 'waiting' && rows.has(entry.activity.target)) continue
    rows.set(entry.activity.target, { target: entry.activity.target, state })
  }
  return [...rows.values()]
}

/**
 * Whether a call changed a file.
 *
 * The verbs are literals the driver's dispatch table picks, never anything the model
 * wrote, so matching them matches the tool that ran rather than prose about it. `changes`
 * is checked as well because only a write carries any: a driver that grows a verb this
 * list has not heard of should still land in the Writes panel, since a write missing from
 * it is the failure this exists to prevent.
 */
function isWrite(activity: Activity): boolean {
  return activity.verb === 'Write' || activity.verb === 'Update' || activity.changes.length > 0
}
