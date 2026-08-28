/**
 * Turning the event stream into something a transcript can draw.
 *
 * The agent reports what it is doing as a sequence of unrelated announcements. A reader
 * wants a single ordered column: what was asked, what was done on the way, and what came
 * back. This is where one becomes the other.
 *
 * The ordering rule is that everything is appended in arrival order and nothing is
 * reordered afterwards. A tool line is *mutated* when it finishes rather than appended
 * again, so a call occupies one row for its whole life.
 */

import type {
  Activity,
  Change,
  ConfirmRequest,
  Landing,
  OutputRequest,
  RunRequest,
  Said,
  Shown,
  VouchRequest,
} from '../shared/protocol'

export type Entry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'narration'; id: string; text: string }
  /** A tool call. `landing` arrives after the call finishes, so it fills in late. */
  | { kind: 'tool'; id: string; activity: Activity; landing: Landing | null }
  | { kind: 'quarantined'; id: string; shown: Shown }
  /** A write awaiting a decision, or the record of one already made. */
  | {
      kind: 'confirm'
      id: string
      request: ConfirmRequest
      decision: 'approve' | 'reject' | null
    }
  /**
   * A pipeline awaiting a decision, or the record of one already made.
   *
   * `remember` is kept next to the decision because the two together are the answer: it
   * says an approval also vouched for the programs, which is why a run already decided
   * still reads differently from one merely allowed once.
   */
  | {
      kind: 'run'
      id: string
      request: RunRequest
      decision: 'approve' | 'reject' | null
      remember: boolean
    }
  /** A command's output awaiting a decision about whether the planner may read it. */
  | {
      kind: 'output'
      id: string
      request: OutputRequest
      decision: 'approve' | 'reject' | null
    }
  /** A quarantined path awaiting a decision about vouching for it. */
  | {
      kind: 'vouch'
      id: string
      request: VouchRequest
      decision: 'approve' | 'reject' | null
    }
  | { kind: 'error'; id: string; text: string }
  /** A replayed tool line from a stored session: no outcome, because none was kept. */
  | { kind: 'replayed-tool'; id: string; text: string }

let counter = 0
const nextId = (): string => `e${++counter}`

/** What a stored session looked like, as entries. */
export function fromSaid(said: Said[]): Entry[] {
  return said.map((entry) => {
    switch (entry.kind) {
      case 'user':
        return { kind: 'user', id: nextId(), text: entry.text } as const
      case 'assistant':
        return { kind: 'assistant', id: nextId(), text: entry.text } as const
      case 'tool':
        // The record does not store what came of a call, so this must not be drawn as
        // though it had an outcome. See docs/phase-0-rpc-protocol.md §7.1.
        return { kind: 'replayed-tool', id: nextId(), text: entry.text } as const
    }
  })
}

export const userSaid = (text: string): Entry => ({ kind: 'user', id: nextId(), text })
export const narrated = (text: string): Entry => ({ kind: 'narration', id: nextId(), text })
export const errored = (text: string): Entry => ({ kind: 'error', id: nextId(), text })
export const quarantined = (shown: Shown): Entry => ({ kind: 'quarantined', id: nextId(), shown })
export const started = (activity: Activity): Entry => ({
  kind: 'tool',
  id: nextId(),
  activity,
  landing: null,
})
export const asked = (request: ConfirmRequest): Entry => ({
  kind: 'confirm',
  id: nextId(),
  request,
  decision: null,
})
export const askedRun = (request: RunRequest): Entry => ({
  kind: 'run',
  id: nextId(),
  request,
  decision: null,
  remember: false,
})
export const askedOutput = (request: OutputRequest): Entry => ({
  kind: 'output',
  id: nextId(),
  request,
  decision: null,
})
export const askedVouch = (request: VouchRequest): Entry => ({
  kind: 'vouch',
  id: nextId(),
  request,
  decision: null,
})
export const replied = (text: string): Entry => ({ kind: 'assistant', id: nextId(), text })

/**
 * Attach a finished call to the row it started in.
 *
 * Matched on the last still-running tool row rather than by an id, because the engine
 * does not give calls one: it announces a start and later a finish, and the pairing is
 * positional. A finish with nothing running is appended as its own row rather than
 * dropped — an unexplained line is better than a missing one.
 */
export function finish(entries: Entry[], activity: Activity): Entry[] {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry?.kind === 'tool' && entry.activity.note === null) {
      const updated = [...entries]
      updated[index] = { ...entry, activity }
      return updated
    }
  }
  return [...entries, { kind: 'tool', id: nextId(), activity, landing: null }]
}

/** Where the last finished call's result went. */
export function land(entries: Entry[], landing: Landing): Entry[] {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry?.kind === 'tool' && entry.landing === null) {
      const updated = [...entries]
      updated[index] = { ...entry, landing }
      return updated
    }
  }
  return entries
}

/** Record what the user decided about a write. */
/** Every entry kind that puts a question to the person. */
export type Asking = Extract<Entry, { decision: 'approve' | 'reject' | null }>

/** Whether an entry is one of the four questions. */
const isAsking = (entry: Entry): entry is Asking =>
  entry.kind === 'confirm' ||
  entry.kind === 'run' ||
  entry.kind === 'output' ||
  entry.kind === 'vouch'

/**
 * Record what was answered.
 *
 * Matched on kind as well as id. The agent numbers its questions in one sequence per turn,
 * so ids do not collide — but a mismatch here would draw the answer on the wrong card, and
 * a card that says a person approved something they did not is the worst kind of wrong this
 * interface can be.
 */
export function decide(
  entries: Entry[],
  kind: Asking['kind'],
  request: number,
  decision: 'approve' | 'reject',
  remember = false,
): Entry[] {
  return entries.map((entry) =>
    isAsking(entry) && entry.kind === kind && entry.request.request === request
      ? entry.kind === 'run'
        ? { ...entry, decision, remember }
        : { ...entry, decision }
      : entry,
  )
}

/**
 * The question still waiting on somebody, if there is one.
 *
 * At most one is ever outstanding: the turn blocks on the answer, so it cannot get as far
 * as asking a second thing. Searched from the end anyway, because that is where it is.
 */
export function outstanding(entries: Entry[]): Asking | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry && isAsking(entry) && entry.decision === null) return entry
  }
  return null
}

/** A diff, condensed, as lines a reader can scan. */
export function diffLines(changes: Change[]): { sign: string; text: string; kind: string }[] {
  return changes.map((change) => {
    switch (change.kind) {
      case 'added':
        return { sign: '+', text: change.text, kind: 'added' }
      case 'removed':
        return { sign: '-', text: change.text, kind: 'removed' }
      case 'kept':
        return { sign: ' ', text: change.text, kind: 'kept' }
      case 'elided':
        return {
          sign: ' ',
          text: `⋯ ${change.lines} unchanged line${change.lines === 1 ? '' : 's'}`,
          kind: 'elided',
        }
    }
  })
}
