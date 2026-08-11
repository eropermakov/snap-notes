import { Tray, Menu, nativeImage } from 'electron'

let tray: Tray | null = null

export interface TrayHandlers {
  iconPath: string
  onOpen: () => void
  onNewNoteCapture: () => void
  onQuit: () => void
}

export function createTray(handlers: TrayHandlers): Tray {
  if (tray) return tray

  const base = nativeImage.createFromPath(handlers.iconPath)
  const trayImage = base.isEmpty() ? base : base.resize({ width: 16, height: 16, quality: 'best' })
  tray = new Tray(trayImage)
  tray.setToolTip('Snap Notes')

  const menu = Menu.buildFromTemplate([
    { label: 'Открыть Snap Notes', click: () => handlers.onOpen() },
    { label: 'Новая заметка + скриншот', click: () => handlers.onNewNoteCapture() },
    { type: 'separator' },
    { label: 'Выход', click: () => handlers.onQuit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => handlers.onOpen())

  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export function isTrayActive(): boolean {
  return tray !== null
}
