import { useMemo, ReactElement } from 'react'
import OverlaySelector from './components/OverlaySelector'
import MainApp from './MainApp'

export default function App(): ReactElement {
  const isOverlay = useMemo(() => window.location.hash.replace(/^#\/?/, '') === 'overlay', [])
  return isOverlay ? <OverlaySelector /> : <MainApp />
}
