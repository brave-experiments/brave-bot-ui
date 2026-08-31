/**
 * The main process: one window, one agent, and a narrow channel between them.
 *
 * The security posture here is not boilerplate. This app drives a tool whose whole point
 * is that untrusted content cannot reach anything that decides, and a renderer with
 * filesystem access would undo that from the outside. So the renderer gets no Node, no
 * remote origins, and no navigation.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bridge, BridgeError } from './bridge'
import { parseLayout } from '../shared/layout'
import { parseView } from '../shared/view'
import { parseContextRef, parseWindowState } from '../shared/commands'
import { installMenu, popupContext, rebuildMenu, refreshMenu } from './menu'
import { noteProject, recents } from './recents'
import { putLayout, putPanels, putTheme, putView, readState } from './state'
import { parsePanels } from '../shared/state'
import { isProjectPath } from '../shared/recents'
import { forks, noteFork } from './forks'
import { isSessionId, parseForkResult } from '../shared/forks'
import { forgetRoot, list, noteRoot, open as openInApp } from './files'
import { isSubpath } from '../shared/files'
import {
  parseExportRequest,
  suggestedFilename,
  toMarkdown,
  toPlainText,
  withExtension,
  type ExportFormat,
  type ExportOutcome,
} from '../shared/export'
import { printToPdf } from './export'
import { readThemes, themesDirectory, watchThemes } from './theme'
import { parseChosenTheme } from '../shared/theme'

let window: BrowserWindow | null = null
let bridge: Bridge | null = null
let stopWatchingThemes: (() => void) | null = null

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    // Traffic lights inset over the sessions column, which is where a chat app puts them.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  })

  window.once('ready-to-show', () => window?.show())

  // Nothing in this app navigates anywhere. A link opens in the user's browser, and an
  // in-window navigation is refused outright rather than sandboxed.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  bridge = new Bridge((message) => {
    window?.webContents.send('bravebot:event', message)
  })

  // Watching the palettes directory, so that editing one is an editing loop rather than a relaunch
  // each time. Torn down with the window rather than at quit: on macOS the last window can close
  // and a new one be built from the dock, and a watcher left holding a `webContents` that is gone
  // would be one more thing keeping it alive.
  stopWatchingThemes?.()
  stopWatchingThemes = watchThemes(() => {
    window?.webContents.send('bravebot:theme:changed', {
      themes: readThemes(),
      chosen: readState().theme,
      directory: themesDirectory(),
    })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    stopWatchingThemes?.()
    stopWatchingThemes = null
    window = null
  })

  // Built here rather than once at startup, because the menu holds the window it delivers a
  // chosen item to. On macOS closing the last window does not quit the app, and clicking the
  // dock icon builds a new one — with the menu installed once, every item would still be
  // pointing at the window that was closed, and the whole menu would go quiet with nothing
  // on screen to say why.
  installMenu(window)
}

/**
 * The methods the renderer may call.
 *
 * An allow-list rather than a pass-through: the renderer names a method and the main
 * process decides whether that is a method at all. A generic "send anything to the
 * agent" channel would make the preload's narrowness decorative.
 */
const ALLOWED = new Set([
  'agent.info',
  'session.list',
  'session.open',
  'session.new',
  'session.fork',
  'session.close',
  'turn.send',
  'turn.cancel',
  'confirm.reply',
  'run.reply',
  'output.reply',
  'vouch.reply',
  'ask.reply',
  'trust.reply',
  'doctor',
])

/** What the save sheet offers per format. */
const FILTERS: Record<ExportFormat, Electron.FileFilter> = {
  txt: { name: 'Plain Text', extensions: ['txt'] },
  md: { name: 'Markdown', extensions: ['md', 'markdown'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
}

/**
 * Remember where a session that has just started is working, for the file tree.
 *
 * The handle comes off the answer in every case. The directory comes off the answer too where
 * there is one — an opened session carries its record, a forked one its own directory — and off
 * the request for `session.new`, which answers with a handle and a branch and nothing else. That
 * one path is the same value this handler already trusts enough to write to the recents list a few
 * lines up, it arrived from a native picker or a list the main process itself keeps, and it is
 * checked as a project path before it becomes a root.
 */
function noteOpenedRoot(method: string, params: unknown, ok: unknown): void {
  if (method !== 'session.open' && method !== 'session.new' && method !== 'session.fork') return
  if (typeof ok !== 'object' || ok === null) return
  const answer = ok as Record<string, unknown>
  if (!isSessionId(answer.session)) return

  if (method === 'session.new') {
    noteRoot(answer.session, (params as { directory?: unknown } | null)?.directory)
    return
  }
  const record = answer.record
  const directory =
    method === 'session.open' && typeof record === 'object' && record !== null
      ? (record as { directory?: unknown }).directory
      : answer.directory
  noteRoot(answer.session, directory)
}

app.whenReady().then(() => {
  ipcMain.handle('bravebot:request', async (_event, method: unknown, params: unknown) => {
    if (typeof method !== 'string' || !ALLOWED.has(method)) {
      return { error: { code: 'bad_request', message: `not a permitted method: ${String(method)}` } }
    }
    if (!bridge) {
      return { error: { code: 'no_bridge', message: 'the agent is not running' } }
    }
    try {
      const ok = await bridge.request(method, (params ?? {}) as Record<string, unknown>)
      // Opening a session is the other way a project becomes recent, and this handler is
      // already the choke point that sees it. Reading one field it is forwarding anyway is
      // a smaller thing than a channel that would let the renderer write the list itself.
      if (method === 'session.open' || method === 'session.new') {
        const directory = (params as { directory?: unknown } | null)?.directory
        if (isProjectPath(directory) && noteProject(directory)) rebuildMenu()
      }
      // A fork is the one call whose *answer* is worth writing down: which session it made and
      // which one it came out of. Read off the agent's reply and never off `params`, so the
      // renderer cannot compose a lineage it was not given — the same promise the recents list
      // makes one line up.
      if (method === 'session.fork') {
        const fork = parseForkResult(ok)
        if (fork) {
          noteFork(fork)
          if (noteProject(fork.child.directory)) rebuildMenu()
        }
      }
      // Which directory each live session is working in, for the file tree in the context
      // column. Recorded at this one choke point because it is the only place that sees both
      // halves at once, and read off the *answer* wherever the answer carries it — the handle
      // always, the directory for an opened or forked session — so a root the tree can browse is
      // one the agent confirmed rather than one the renderer asserted. See `files.ts`.
      noteOpenedRoot(method, params, ok)
      if (method === 'session.close') {
        const closing = (params as { session?: unknown } | null)?.session
        if (isSessionId(closing)) forgetRoot(closing)
      }
      return { ok }
    } catch (error) {
      if (error instanceof BridgeError) {
        return { error: { code: error.code, message: error.message } }
      }
      return { error: { code: 'internal', message: String(error) } }
    }
  })

  /**
   * Write the conversation to a file the user picks.
   *
   * Note what this does not touch: `ALLOWED` above. An export reaches no agent method — it
   * is made entirely of things the window already had — so the list of things the renderer
   * may ask the agent to do is exactly as long as it was. Anyone checking whether this
   * feature widened the app's reach should find that it did not.
   *
   * The renderer sends turns; this composes the file. See `shared/export.ts` for why that
   * way round.
   */
  ipcMain.handle('bravebot:export', async (_event, value: unknown): Promise<ExportOutcome> => {
    const request = parseExportRequest(value)
    // Deliberately does not echo what arrived. A message about a malformed export is for
    // the person, and the payload is the one thing they cannot act on.
    if (!request) {
      return { status: 'failed', message: 'that is not a conversation this build can export' }
    }
    if (!window) return { status: 'failed', message: 'there is no window to ask in' }

    // Stamped here rather than sent from the renderer: one fewer value crossing, and the
    // process that writes the file is the one with an opinion about when it was written.
    const at = Date.now()
    const result = await dialog.showSaveDialog(window, {
      title: 'Export session',
      defaultPath: join(
        app.getPath('documents'),
        suggestedFilename(request.document.title, request.format),
      ),
      filters: [FILTERS[request.format]],
      properties: ['createDirectory'],
    })
    // A cancelled sheet is not a failure and says nothing on screen.
    if (result.canceled || !result.filePath) return { status: 'cancelled' }

    const target = withExtension(result.filePath, request.format)
    try {
      if (request.format === 'pdf') {
        writeFileSync(target, await printToPdf(request.document, at))
      } else {
        const text =
          request.format === 'md'
            ? toMarkdown(request.document, at)
            : toPlainText(request.document, at)
        writeFileSync(target, text, 'utf8')
      }
      return { status: 'saved', where: target }
    } catch (error) {
      // Unlike a layout that cannot be written, this one is worth saying out loud: somebody
      // asked for a file and does not have one.
      return { status: 'failed', message: String(error) }
    }
  })

  // What the window remembers between launches: the column widths and folds, how the session
  // list is arranged, and which panels the context column is showing.
  //
  // A file rather than `localStorage`, because the renderer is loaded from `file://` and
  // Chromium does not keep storage for that origin across launches — writes work for the
  // life of the window and are gone by the next one. Measured, not assumed. `state.ts` owns
  // that file and replaces one key per write, so a preference crossing here cannot disturb
  // another one, and the two lists in it that the renderer may read have no channel that
  // writes them.
  //
  // The renderer is ours, but this still validates what it sends: the value is written to
  // disk and read back on the next launch, so a bad write would be a bug that outlives the
  // session that caused it. One validator per shape is the whole of the judgement, on the way
  // in and on the way out — so what lands on disk is the parsed value and never the object
  // the renderer happened to pass.

  ipcMain.handle('bravebot:layout:read', () => readState().layout)

  ipcMain.handle('bravebot:layout:write', (_event, value: unknown) => {
    const layout = parseLayout(value)
    if (!layout) return
    putLayout(layout)
  })

  ipcMain.handle('bravebot:view:read', () => readState().view)

  ipcMain.handle('bravebot:view:write', (_event, value: unknown) => putView(parseView(value)))

  ipcMain.handle('bravebot:panels:read', () => readState().panels)

  ipcMain.handle('bravebot:panels:write', (_event, value: unknown) => putPanels(parsePanels(value)))

  // The theme. The chosen name is a key in the same file as the three above; the list it is chosen
  // from is built here, because reading a directory of palettes is not something the renderer does.
  //
  // What crosses is a *name*. Not a path — the renderer cannot see the filesystem and this does not
  // become the first place it can reach one — and not a colour either, so nothing painted in this
  // window is something the renderer composed. Validated on the way in like the rest, and checked
  // against the list as well: a name nobody is offering is a bug on this side rather than a
  // preference, and writing it down would outlive the session that caused it.

  ipcMain.handle('bravebot:theme:read', () => ({
    themes: readThemes(),
    chosen: readState().theme,
    directory: themesDirectory(),
  }))

  ipcMain.handle('bravebot:theme:write', (_event, value: unknown) => {
    const name = parseChosenTheme(value)
    if (!readThemes().some((theme) => theme.name === name)) return
    putTheme(name)
  })

  // Choosing a project is a native affair: the renderer cannot see the filesystem and
  // should not be handed a path it invented.
  ipcMain.handle('bravebot:choose-directory', async () => {
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Open a project',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return null
    const directory = result.filePaths[0] ?? null
    // Recorded here, where a real directory has just been chosen, rather than being taken
    // from the renderer later. The recents list is the main process's own record; the
    // renderer can read it and ask to open something on it, and cannot write to it.
    if (directory && noteProject(directory)) rebuildMenu()
    return directory
  })

  /** The projects opened before, newest first. Read-only on purpose. */
  ipcMain.handle('bravebot:recents:read', () => recents())

  /** Which session came out of which. Read-only for the same reason the recents list is. */
  ipcMain.handle('bravebot:forks:read', () => forks())

  // Looking at the folder a session is working in.
  //
  // The pair that crosses is a session handle and a path relative to that session's directory,
  // and both are refused here before anything becomes a syscall. The roots are the main process's
  // own record of what the agent answered, so there is no channel on which the renderer can name a
  // folder — the promise `choose-directory` makes, kept for a second feature. `files.ts` has the
  // resolution and the reason a lexical check is only half of it.
  //
  // Note what this does not touch: `ALLOWED` above. The tree reaches no agent method, so the list
  // of things the renderer may ask the agent to do is exactly as long as it was.
  ipcMain.handle('bravebot:files:list', (_event, session: unknown, path: unknown) => {
    if (!isSessionId(session) || !isSubpath(path)) return null
    return list(session, path)
  })

  ipcMain.handle('bravebot:files:open', async (_event, session: unknown, path: unknown) => {
    if (!isSessionId(session) || !isSubpath(path)) {
      // Deliberately not an echo of what arrived, the way the export refusal is not: the message
      // is for the person, and the payload is the one thing they cannot act on.
      return { status: 'failed', message: 'that is not a file in this project' }
    }
    return openInApp(session, path)
  })

  // What the window can currently do, so the menu can grey what it cannot. The renderer is
  // the only thing that knows this, and it says so rather than being asked: a menu that has
  // to poll would be a second copy of the transcript's state, arriving late.
  ipcMain.on('bravebot:menu:state', (_event, value: unknown) => {
    const state = parseWindowState(value)
    if (state) refreshMenu(state)
  })

  // A right-click on something in the window. The reference is validated rather than
  // trusted: it decides which menu is built, and an unrecognised one gets no menu at all.
  ipcMain.on('bravebot:menu:popup', (_event, value: unknown) => {
    const reference = parseContextRef(value)
    if (reference) popupContext(reference)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Closing stdin tells the agent the front-end has gone, which refuses anything waiting on
 * an approval. Doing it here rather than letting the process die means the refusal is
 * deliberate rather than a consequence of a dropped pipe.
 */
app.on('before-quit', () => {
  bridge?.dispose()
  bridge = null
})
