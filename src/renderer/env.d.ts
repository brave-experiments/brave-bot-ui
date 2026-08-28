/// <reference types="vite/client" />
import type { BravebotApi } from '../preload/index'

declare global {
  interface Window {
    bravebot: BravebotApi
  }
}
