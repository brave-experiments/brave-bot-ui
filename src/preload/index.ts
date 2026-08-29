/**
 * The only thing the renderer can reach.
 *
 * A handful of functions and a subscription. No filesystem, no child processes, no IPC
 * surface beyond this: the renderer asks the main process to call a named method, and the
 * main process decides whether that is a method at all. The layout pair is the one thing
 * here that is not about the agent — it stores where the columns were, and the main
 * process checks that that is all it is.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { BridgeEvent, BridgeFailure } from '../shared/protocol'
import type { StoredLayout } from '../shared/layout'
import type { CommandId, ContextCommandId, ContextRef, WindowState } from '../shared/commands'
import type { ExportOutcome, ExportRequest } from '../shared/export'

export interface Answer<T> {
  ok?: T
  error?: BridgeFailure
}

const api = {
  /** Call one of the agent's methods. Never throws; failures come back in `error`. */
  request<T>(method: string, params?: Record<string, unknown>): Promise<Answer<T>> {
    return ipcRenderer.invoke('bravebot:request', method, params ?? {}) as Promise<Answer<T>>
  },

  /**
   * The columns from last launch — their widths and which were folded shut — or `null` for
   * a window that has never been arranged.
   *
   * Kept by the main process rather than in `localStorage`: the renderer runs on a
   * `file://` origin, whose storage Chromium discards between launches.
   */
  readLayout(): Promise<StoredLayout | null> {
    return ipcRenderer.invoke('bravebot:layout:read') as Promise<StoredLayout | null>
  },

  /** Remember where the columns were. Best-effort; the caller does not wait or check. */
  writeLayout(layout: StoredLayout): void {
    void ipcRenderer.invoke('bravebot:layout:write', layout)
  },

  /**
   * The projects opened before, newest first.
   *
   * There is no write half, deliberately: the main process records these when it hands out
   * a directory, so this list is something the renderer can show but not forge an entry in.
   */
  readRecents(): Promise<string[]> {
    return ipcRenderer.invoke('bravebot:recents:read') as Promise<string[]>
  },

  /** Ask the user for a project directory, natively. */
  chooseDirectory(): Promise<string | null> {
    return ipcRenderer.invoke('bravebot:choose-directory') as Promise<string | null>
  },

  /**
   * Write the conversation to a file the user picks.
   *
   * The structured turns cross, not a finished document. The main process serializes them
   * and writes the result, so what lands on disk is something it composed from a value it
   * parsed rather than bytes this side handed over — the same discipline `writeLayout`
   * follows, for a value that matters rather more.
   *
   * There is no read half and no path argument: where the file goes is decided in a native
   * sheet, so the renderer cannot name a destination any more than it can name a project
   * directory. Never throws; a refusal comes back in `status`.
   */
  exportSession(request: ExportRequest): Promise<ExportOutcome> {
    return ipcRenderer.invoke('bravebot:export', request) as Promise<ExportOutcome>
  },

  /**
   * Listen for menu items being chosen. Returns an unsubscribe.
   *
   * One channel carrying one id, not a general "run this in the renderer" hook. The id is
   * checked against the command list on the way out and again on the way in, and that list
   * contains nothing that answers a question the agent asked — those are answered in the
   * transcript, beside the evidence, and a menu is not beside anything.
   */
  onCommand(
    listener: (id: CommandId | ContextCommandId, context: ContextRef | null) => void,
  ): () => void {
    const handler = (
      _event: IpcRendererEvent,
      id: CommandId | ContextCommandId,
      context: ContextRef | null,
    ) => listener(id, context)
    ipcRenderer.on('bravebot:command', handler)
    return () => ipcRenderer.off('bravebot:command', handler)
  },

  /**
   * Ask for the menu that belongs to a thing on screen.
   *
   * Carries which kind of thing and which one, and nothing else. What the menu says is
   * decided in the main process from labels compiled into it — the renderer cannot put a
   * word on screen this way, which is the point: a transcript can hold content the agent
   * read off disk.
   */
  popupContext(reference: ContextRef): void {
    ipcRenderer.send('bravebot:menu:popup', reference)
  },

  /**
   * Tell the menu what is currently possible.
   *
   * Without it "Cancel Turn" is black with nothing running and "Send" is black with an
   * empty composer — a menu offering what the window will refuse. Best-effort and
   * unanswered, like `writeLayout`: a menu item left momentarily wrong is not worth a
   * round trip.
   */
  publishState(state: WindowState): void {
    ipcRenderer.send('bravebot:menu:state', state)
  },

  /** Listen for everything the agent announces. Returns an unsubscribe. */
  onEvent(listener: (event: BridgeEvent) => void): () => void {
    const handler = (_event: IpcRendererEvent, message: BridgeEvent) => listener(message)
    ipcRenderer.on('bravebot:event', handler)
    return () => ipcRenderer.off('bravebot:event', handler)
  },
}

contextBridge.exposeInMainWorld('bravebot', api)

export type BravebotApi = typeof api
