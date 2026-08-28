/**
 * Every action the interface offers from a menu, declared once.
 *
 * Three surfaces want this list: the native menu bar builds items from it, the accelerators
 * in that menu *are* the app's keyboard shortcuts, and an in-window menu draws rows from it.
 * Three hardcoded copies would drift — a menu that promises a shortcut nothing listens for
 * is worse than no menu — so the declaration lives here, in `shared`, which is the one place
 * the main process and the renderer can both reach. `layout.ts` next door plays the same
 * role for the remembered columns.
 *
 * Nothing here imports `electron` or `react`. That is what makes it shareable, and it is
 * why the accelerator is a string rather than anything that knows how to fire.
 *
 * ## What is deliberately absent
 *
 * There is no command that answers a question. The five the agent can ask — a write, a
 * command to run, whether the planner may read output, whether to vouch, and a series of
 * questions — are answered in the transcript, beside the evidence they are about, and
 * nowhere else. A keystroke that approved a write from across the window would be a
 * decision taken without looking at it, which is the one thing this whole app is arranged
 * to prevent. The absence is structural rather than a rule somebody has to remember: no
 * `CommandId` names an approval, so there is nothing for the menu layer to dispatch.
 */

export type CommandId =
  | 'session.new'
  | 'session.close'
  | 'turn.send'
  | 'turn.cancel'
  | 'view.fold-left'
  | 'view.fold-right'
  | 'view.reset-columns'
  | 'app.about'
  | 'help.doctor'

/**
 * What has to be true of the window before a command means anything.
 *
 * Kept as a tag rather than a predicate closure so that it can cross the process boundary
 * with the rest of the declaration: the main process greys a menu item by it, and anything
 * drawing an in-window menu can grey a row by the same tag rather than by its own opinion.
 */
export type Requires = 'always' | 'session' | 'running' | 'sendable'

export interface Command {
  id: CommandId
  /** The resting label. Two commands override it with the state — see [`menuLabel`]. */
  label: string
  /** Electron's accelerator form, e.g. `CmdOrCtrl+N`. Absent where there is no shortcut. */
  accelerator?: string
  requires: Requires
}

/**
 * As much of the window's state as a menu needs to know.
 *
 * Deliberately tiny. The renderer holds the session, the transcript and the columns; what
 * crosses to the main process is three booleans, because that is all that decides whether
 * an item is grey and what two of them are called. Sending more would make the main process
 * a second, stale copy of the renderer's state.
 */
export interface WindowState {
  hasSession: boolean
  running: boolean
  /**
   * There is a session, nothing is running, and the composer has something in it.
   *
   * Sent rather than derived from the first two, because whether the draft is empty is
   * known only to the renderer and it is the difference between a Send item that works and
   * one that is offered and then does nothing.
   */
  canSend: boolean
  folded: { left: boolean; right: boolean }
}

export const NOTHING_OPEN: WindowState = {
  hasSession: false,
  running: false,
  canSend: false,
  folded: { left: false, right: false },
}

export const COMMANDS: readonly Command[] = [
  { id: 'session.new', label: 'New Session…', accelerator: 'CmdOrCtrl+N', requires: 'always' },
  {
    id: 'session.close',
    label: 'Close Session',
    accelerator: 'CmdOrCtrl+Shift+W',
    requires: 'session',
  },
  { id: 'turn.send', label: 'Send', accelerator: 'CmdOrCtrl+Enter', requires: 'sendable' },
  { id: 'turn.cancel', label: 'Cancel Turn', accelerator: 'CmdOrCtrl+.', requires: 'running' },
  {
    id: 'view.fold-left',
    label: 'Hide Session List',
    accelerator: 'CmdOrCtrl+Alt+Left',
    requires: 'always',
  },
  {
    id: 'view.fold-right',
    label: 'Hide Context Panel',
    accelerator: 'CmdOrCtrl+Alt+Right',
    requires: 'always',
  },
  { id: 'view.reset-columns', label: 'Reset Columns', requires: 'always' },
  { id: 'app.about', label: 'About Brave Bot', requires: 'always' },
  { id: 'help.doctor', label: 'Run Diagnostics…', requires: 'always' },
]

const BY_ID = new Map<CommandId, Command>(COMMANDS.map((command) => [command.id, command]))

/** The declaration for one id. Throws, because an unknown id is a typo, not a condition. */
export function command(id: CommandId): Command {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`no such command: ${id}`)
  return found
}

/** Whether a command can be chosen, given what the window is currently doing. */
export function isEnabled(requires: Requires, state: WindowState): boolean {
  switch (requires) {
    case 'always':
      return true
    case 'session':
      return state.hasSession
    case 'running':
      return state.hasSession && state.running
    case 'sendable':
      return state.canSend
  }
}

/**
 * A window state, or nothing.
 *
 * The renderer is ours, but this value decides whether a menu item can be clicked, and the
 * main process has no other source for it. Nothing is coerced, for the reason `parseLayout`
 * gives next door: a half-understood message is not a state, and guessing at one is how a
 * menu ends up grey during a turn it should be able to cancel.
 *
 * `null` means "leave the menu as it was", which is the safe reading — a bad message can
 * never be the thing that *enables* an item.
 */
export function parseWindowState(value: unknown): WindowState | null {
  if (typeof value !== 'object' || value === null) return null
  const { hasSession, running, canSend, folded } = value as Record<string, unknown>
  if (typeof hasSession !== 'boolean') return null
  if (typeof running !== 'boolean') return null
  if (typeof canSend !== 'boolean') return null
  if (typeof folded !== 'object' || folded === null) return null
  const { left, right } = folded as Record<string, unknown>
  if (typeof left !== 'boolean' || typeof right !== 'boolean') return null
  return { hasSession, running, canSend, folded: { left, right } }
}

/**
 * What a command is called right now.
 *
 * The two fold commands are the only ones that rename themselves, and they follow the
 * convention the fold buttons in the transcript header already use: the label says what
 * pressing it will do, not what the column currently is. A label that read "Session list"
 * and left the reader to infer the direction would be a state announced twice.
 */
export function menuLabel(item: Command, state: WindowState): string {
  if (item.id === 'view.fold-left') {
    return state.folded.left ? 'Show Session List' : 'Hide Session List'
  }
  if (item.id === 'view.fold-right') {
    return state.folded.right ? 'Show Context Panel' : 'Hide Context Panel'
  }
  return item.label
}

/** Whether an unknown string is a command this build declares. Used at the IPC boundary. */
export function isCommandId(value: unknown): value is CommandId {
  return typeof value === 'string' && BY_ID.has(value as CommandId)
}

// ------------------------------------------------------------------ context menus

/**
 * The kinds of thing that have a menu of their own when right-clicked.
 *
 * A closed union rather than a free string, because this is what the renderer is allowed to
 * say when it asks for a popup, and the main process builds the menu from it.
 */
export type ContextTarget = 'session' | 'entry' | 'directory'

export type ContextCommandId =
  /** Start a session in a project the main process named, from File > Open Recent. */
  | 'session.new-here'
  | 'context.session.open'
  | 'context.session.close'
  | 'context.session.copy-path'
  | 'context.entry.copy'

/**
 * What appears on a right-click, decided here and built in the main process.
 *
 * The labels are compiled in. The renderer says *which kind of thing* was clicked and
 * *which one*, and nothing else — no path, no transcript text, no diff line. That matters
 * more here than anywhere else in the app: a transcript can hold content the agent read off
 * disk, and a native menu whose label came from that content, pointing at a path that came
 * from it too, is exactly the injection this whole program is arranged to prevent. So the
 * renderer cannot put a word on screen through this channel even if something has convinced
 * it to try.
 *
 * Note what an entry offers: copying, and nothing else. A confirm card, a command about to
 * be run and a quarantined blob all get the same one item as a plain message. Approving is
 * not on a context menu for the same reason it is not on an accelerator.
 */
export const CONTEXT: Record<ContextTarget, readonly { id: ContextCommandId; label: string }[]> = {
  // Not right-clickable: a directory reference only ever arrives from File > Open Recent,
  // which builds its own items. It is here so the union is total.
  directory: [],
  session: [
    { id: 'context.session.open', label: 'Open' },
    { id: 'context.session.close', label: 'Close Session' },
    { id: 'context.session.copy-path', label: 'Copy Project Path' },
  ],
  entry: [{ id: 'context.entry.copy', label: 'Copy' }],
}

/** Which thing was clicked. An identifier and a kind; never anything renderable. */
export interface ContextRef {
  target: ContextTarget
  id: string
}

export function parseContextRef(value: unknown): ContextRef | null {
  if (typeof value !== 'object' || value === null) return null
  const { target, id } = value as Record<string, unknown>
  if (target !== 'session' && target !== 'entry' && target !== 'directory') return null
  if (typeof id !== 'string' || id.length === 0) return null
  return { target, id }
}

export function isContextCommandId(value: unknown): value is ContextCommandId {
  return (
    typeof value === 'string' &&
    (CONTEXT.session.some((i) => i.id === value) || CONTEXT.entry.some((i) => i.id === value))
  )
}
