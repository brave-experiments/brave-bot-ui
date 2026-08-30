/**
 * The main process: one window, one agent, and a narrow channel between them.
 *
 * The security posture here is not boilerplate. This app drives a tool whose whole point
 * is that untrusted content cannot reach anything that decides, and a renderer with
 * filesystem access would undo that from the outside. So the renderer gets no Node, no
 * remote origins, and no navigation.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bridge, BridgeError } from './bridge'
import { parseLayout } from '../shared/layout'
import { parseView } from '../shared/view'
import { parseContextRef, parseWindowState } from '../shared/commands'
import { installMenu, popupContext, rebuildMenu, refreshMenu } from './menu'
import { noteProject, recents } from './recents'
import { isProjectPath } from '../shared/recents'
import { forks, noteFork } from './forks'
import { parseForkResult } from '../shared/forks'
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

let window: BrowserWindow | null = null
let bridge: Bridge | null = null

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

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
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

  // Where the column widths live.
  //
  // A file rather than `localStorage`, because the renderer is loaded from `file://` and
  // Chromium does not keep storage for that origin across launches — writes work for the
  // life of the window and are gone by the next one. Measured, not assumed.
  //
  // The renderer is ours, but this still validates what it sends: the value is written to
  // disk and read back on the next launch, so a bad write would be a bug that outlives the
  // session that caused it. `parseLayout` is the whole of the judgement, on the way in and
  // on the way out — so what lands on disk is the parsed layout and never the object the
  // renderer happened to pass, and a renderer bug cannot leave a fourth field in the file.
  const layoutFile = (): string => join(app.getPath('userData'), 'layout.json')

  ipcMain.handle('bravebot:layout:read', () => {
    try {
      return parseLayout(JSON.parse(readFileSync(layoutFile(), 'utf8')))
    } catch {
      // No file yet, or one nothing can read. Either way the defaults are correct.
      return null
    }
  })

  ipcMain.handle('bravebot:layout:write', (_event, value: unknown) => {
    const layout = parseLayout(value)
    if (!layout) return
    try {
      writeFileSync(layoutFile(), JSON.stringify(layout), 'utf8')
    } catch {
      // A layout that cannot be written down is not worth an error on screen.
    }
  })

  // Where the session list's own arrangement lives — at the moment, whether it is grouped
  // by checkout.
  //
  // Its own file rather than a field in the layout, for the reason `shared/view.ts` gives:
  // one file per shape, so a hand-edited preference here cannot cost somebody the column
  // widths next door. The same in-and-out discipline as the layout otherwise — `parseView`
  // is the whole of the judgement both ways, so what lands on disk is the parsed value and
  // never the object the renderer happened to pass.
  const viewFile = (): string => join(app.getPath('userData'), 'view.json')

  ipcMain.handle('bravebot:view:read', () => {
    try {
      return parseView(JSON.parse(readFileSync(viewFile(), 'utf8')))
    } catch {
      // No file yet, or one nothing can read. Either way the flat list is correct.
      return parseView(null)
    }
  })

  ipcMain.handle('bravebot:view:write', (_event, value: unknown) => {
    try {
      writeFileSync(viewFile(), JSON.stringify(parseView(value)), 'utf8')
    } catch {
      // A preference that cannot be written down is not worth an error on screen.
    }
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
