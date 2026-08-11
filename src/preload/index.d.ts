import { ElectronAPI } from '@electron-toolkit/preload'
import type { SnapNotesApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: SnapNotesApi
  }
}
