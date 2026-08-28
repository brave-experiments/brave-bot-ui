/// <reference types="vite/client" />
import type { BuaApi } from '../preload/index'

declare global {
  interface Window {
    bua: BuaApi
  }
}
