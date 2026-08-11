import AutoLaunch from 'auto-launch'
import { app } from 'electron'

function makeInstance(hidden: boolean): AutoLaunch {
  return new AutoLaunch({
    name: 'Snap Notes',
    path: app.getPath('exe'),
    isHidden: hidden
  })
}

export async function syncAutoLaunch(enabled: boolean, hidden: boolean): Promise<void> {
  const al = makeInstance(hidden)
  const isEnabled = await al.isEnabled().catch(() => false)
  if (enabled && !isEnabled) {
    await al.enable()
  } else if (!enabled && isEnabled) {
    await al.disable()
  } else if (enabled && isEnabled) {
    await al.disable().catch(() => {})
    await al.enable()
  }
}

export async function isAutoLaunchEnabled(): Promise<boolean> {
  try {
    return await makeInstance(false).isEnabled()
  } catch {
    return false
  }
}
