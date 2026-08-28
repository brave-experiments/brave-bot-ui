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

import type { Activity, Change, ConfirmRequest, Landing, Said, Shown } from '../shared/protocol'

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
export function decide(
  entries: Entry[],
  request: number,
  decision: 'approve' | 'reject',
): Entry[] {
  return entries.map((entry) =>
    entry.kind === 'confirm' && entry.request.request === request
      ? { ...entry, decision }
      : entry,
  )
}

/** The write still waiting on somebody, if there is one. */
export function outstanding(entries: Entry[]): ConfirmRequest | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry?.kind === 'confirm' && entry.decision === null) return entry.request
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
