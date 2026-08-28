/**
 * The wire format, as TypeScript.
 *
 * Mirrors `docs/phase-0-rpc-protocol.md` §6 and the Rust in `crates/bua-bridge/src/wire.rs`.
 * Nothing here is generated, so the two can drift; the tags are the contract and they are
 * pinned by tests on the Rust side.
 *
 * Two rules carried over from the spec, because they matter as much here as there:
 *
 * 1. Match on the tag, never on prose. `Landing` and `Reach` have `describe()` methods
 *    upstream that return sentences meant for a screen. Those sentences are not sent, and
 *    a UI that matched on one would be matching on wording that will change.
 * 2. An unrecognised tag degrades toward *less* trust. Every helper below that maps a tag
 *    to a rendering decision defaults to the quarantined/untrusted reading.
 */

export type Intent = 'create' | 'overwrite' | 'edit'
export type Phase = 'planning' | 'thinking' | 'compacting' | 'reconnecting'
export type Reach = 'not_the_planner' | 'no_model'
export type Landing = 'context' | 'quarantined' | 'reserved'
export type TodoStatus = 'pending' | 'active' | 'done'
export type SaidKind = 'user' | 'assistant' | 'tool'

export type Change =
  | { kind: 'kept'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'elided'; lines: number }

export interface Activity {
  verb: string
  target: string
  /** `null` while the call is still running. Absent-vs-null matters: see the Rust doc. */
  note: string | null
  failed: boolean
  untrusted: boolean
  changes: Change[]
}

export interface Shown {
  origin: string
  reach: Reach
  label: string
  /** Already trimmed by the kernel to 12 lines of at most 160 characters. */
  preview: string[]
  /** The true total, so a preview can say what it left out. */
  lines: number
}

export interface Said {
  kind: SaidKind
  text: string
}

export interface TodoRow {
  content: string
  status: TodoStatus
}

export interface SessionSummary {
  id: string
  directory: string
  project: string
  branch: string | null
  title: string
  updated: number
  bytes: number
}

export interface SessionRecord {
  id: string
  directory: string
  branch: string | null
  title: string
  started: number
  updated: number
  turns: number
  tokens: number
  build: string | null
}

export interface OpenedSession {
  session: string
  record: SessionRecord
  said: Said[]
  context: string
  todos: Record<string, TodoRow[]>
  trust: { known: boolean; rules: { path: string; integrity: string }[] | null }
  branchNote: string | null
  buildNote: string | null
}

export interface ConfirmRequest {
  request: number
  path: string
  intent: Intent
  untrusted: boolean
  existing: boolean
  added: number
  removed: number
  exact: boolean
  changes: Change[]
}

export interface TurnDone {
  turn: number
  reply: string
  model: string
  steps: number
  clean: boolean
  tokens: number
  outputTokens: number
  notices: string[]
  trust: { rules: { path: string; integrity: string }[] }
}

export interface TurnError {
  turn: number
  kind: 'cancelled' | 'precommit' | 'workspace' | 'chat'
  message: string
}

/** Every event the bridge emits, keyed by name. */
export interface EventMap {
  'agent.ready': { build: string; version: string; home: string | null }
  'trust.request': { directory: string }
  'turn.started': { turn: number }
  phase: { phase: Phase }
  narration: { text: string }
  'tool.started': Activity
  'tool.finished': Activity
  landed: { landing: Landing }
  quarantined: Shown
  todos: { rows: TodoRow[] }
  tokens: { written: number }
  audit: { turn: number; event: Record<string, unknown> }
  'confirm.request': ConfirmRequest
  'turn.done': TurnDone
  'turn.error': TurnError
}

export type EventName = keyof EventMap

/**
 * One event, as a discriminated union over its name.
 *
 * Written as a mapped type rather than `{ event: EventName; data: EventMap[EventName] }`,
 * which looks equivalent and is not: that form pairs every name with every payload, so
 * narrowing on `event` tells the compiler nothing and every handler has to cast. This
 * form gives one member per name, so `switch (message.event)` narrows `data` with it.
 */
export type BridgeEvent = {
  [N in EventName]: { event: N; session?: string; data: EventMap[N] }
}[EventName]

export interface BridgeFailure {
  code: string
  message: string
}

// ---------------------------------------------------------------- reading tags

/**
 * Whether content at this landing reached the planner.
 *
 * Anything unrecognised reads as *not* reaching it, which is the safe direction: calling
 * quarantined content "read by the model" understates the confinement, and calling
 * context "quarantined" merely overstates it.
 */
export function reachedThePlanner(landing: Landing | string): boolean {
  return landing === 'context'
}

/** Whether a tag names something the planner was kept away from. */
export function isConfined(landing: Landing | string): boolean {
  return landing !== 'context'
}
