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
  'session.close',
  'turn.send',
  'turn.cancel',
  'confirm.reply',
  'run.reply',
  'output.reply',
  'vouch.reply',
  'trust.reply',
  'doctor',
])

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
      return { ok }
    } catch (error) {
      if (error instanceof BridgeError) {
        return { error: { code: error.code, message: error.message } }
      }
      return { error: { code: 'internal', message: String(error) } }
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

  // Choosing a project is a native affair: the renderer cannot see the filesystem and
  // should not be handed a path it invented.
  ipcMain.handle('bravebot:choose-directory', async () => {
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Open a project',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
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
