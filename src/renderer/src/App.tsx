import { useMemo, ReactElement } from 'react'
import OverlaySelector from './components/OverlaySelector'
import CaptureHud from './components/capture/CaptureHud'
import MainApp from './MainApp'

export default function App(): ReactElement {
  const route = useMemo(() => window.location.hash.replace(/^#\/?/, ''), [])
  if (route === 'overlay') return <OverlaySelector />
  if (route === 'hud') return <CaptureHud />
  return <MainApp />
}
