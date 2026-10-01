import { useEffect, useRef, useState, ReactElement } from 'react'
interface Point {
  x: number
  y: number
}

export default function OverlaySelector(): ReactElement {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)
  const [session, setSession] = useState<{ count: number } | null>(null)
  const draggingRef = useRef(false)
  const sessionRef = useRef<{ count: number } | null>(null)

  useEffect(() => {
    const offImage = window.api.overlay.onImage((dataUrl) => {
      setImageUrl(dataUrl)
      setStart(null)
      setCurrent(null)
    })
    // Sent right before each image: whether a Capture Session is running (§13).
    const offMode = window.api.overlay.onMode((mode) => {
      sessionRef.current = mode.session ?? null
      setSession(mode.session ?? null)
    })
    window.api.overlay.ready()
    return () => {
      offImage()
      offMode()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || (e.key === 'Enter' && sessionRef.current)) {
        // During a Capture Session, Enter and Esc finish the session.
        if (sessionRef.current) window.api.overlay.finishSession()
        void window.api.overlay.cancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleMouseDown = (e: React.MouseEvent): void => {
    draggingRef.current = true
    const point = { x: e.clientX, y: e.clientY }
    setStart(point)
    setCurrent(point)
  }

  const handleMouseMove = (e: React.MouseEvent): void => {
    if (!draggingRef.current) return
    setCurrent({ x: e.clientX, y: e.clientY })
  }

  const handleMouseUp = (): void => {
    if (!draggingRef.current || !start || !current) return
    draggingRef.current = false
    const rect = {
      x: Math.round(Math.min(start.x, current.x)),
      y: Math.round(Math.min(start.y, current.y)),
      width: Math.round(Math.abs(current.x - start.x)),
      height: Math.round(Math.abs(current.y - start.y))
    }
    if (rect.width < 4 || rect.height < 4) {
      setStart(null)
      setCurrent(null)
      return
    }
    void window.api.overlay.selectRegion(rect)
  }

  const rect =
    start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y)
        }
      : null

  return (
    <div
      className="relative h-screen w-screen overflow-hidden"
      style={{ cursor: 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {imageUrl && (
        <img
          src={imageUrl}
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          alt=""
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-black/35" style={{ display: rect ? 'none' : 'block' }} />

      {rect && (
        <div
          className="pointer-events-none absolute border-2 border-accent"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)'
          }}
        >
          <span className="absolute -top-7 left-0 whitespace-nowrap rounded bg-black/75 px-2 py-0.5 font-mono text-xs text-white">
            {rect.width} × {rect.height}
          </span>
        </div>
      )}

      {!rect && (
        <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-base text-white">
          {session
            ? `Сессия захвата · фрагментов: ${session.count} — выделите следующий. Enter или Esc — завершить`
            : 'Выделите область — Esc для отмены'}
        </div>
      )}
    </div>
  )
}
