import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../shared/ipc'
import type { ToastPayload } from '../shared/types'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let getWin: (() => BrowserWindow | null) | null = null

function toast(type: ToastPayload['type'], message: string): void {
  const win = getWin?.() ?? null
  if (!win || win.isDestroyed()) return
  const payload: ToastPayload = { id: randomUUID(), type, message }
  win.webContents.send(IPC.ON_TOAST, payload)
}

export function initUpdater(getMainWindow: () => BrowserWindow | null): void {
  getWin = getMainWindow

  if (is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    toast('success', `Доступно обновление ${info.version} — скачивается в фоне`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    const win = getWin?.()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.ON_UPDATE_READY, info.version)
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err)
  })

  void autoUpdater.checkForUpdates().catch((err: Error) => console.error('[updater] check failed', err))

  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => {})
  }, CHECK_INTERVAL_MS)
}

export async function checkForUpdatesNow(): Promise<{ ok: boolean; message: string }> {
  if (is.dev) {
    return { ok: false, message: 'Проверка обновлений недоступна в режиме разработки' }
  }
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true, message: 'Проверка запущена — если есть обновление, оно скачается в фоне' }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export function installUpdateNow(): void {
  autoUpdater.quitAndInstall()
}
