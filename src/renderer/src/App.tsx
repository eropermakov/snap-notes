import { useMemo, ReactElement } from 'react'
import OverlaySelector from './components/OverlaySelector'
import CaptureHud from './components/capture/CaptureHud'
import QuickNote from './components/QuickNote'
import FloatingNote from './components/FloatingNote'
import MainApp from './MainApp'

export default function App(): ReactElement {
  const route = useMemo(() => window.location.hash.replace(/^#\/?/, ''), [])
  if (route === 'overlay') return <OverlaySelector />
  if (route === 'hud') return <CaptureHud />
  if (route === 'quick') return <QuickNote />
  const floating = /^note\/([a-zA-Z0-9_-]{1,64})$/.exec(route)
  if (floating) return <FloatingNote noteId={floating[1]} />
  return <MainApp />
}
