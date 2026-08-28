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

  /** Ask the user for a project directory, natively. */
  chooseDirectory(): Promise<string | null> {
    return ipcRenderer.invoke('bravebot:choose-directory') as Promise<string | null>
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
