export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Align = 'start' | 'center' | 'end'
export type Placement = Side | `${Side}-${Exclude<Align, 'center'>}`

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const VIEWPORT_PAD = 8

function parse(placement: Placement): { side: Side; align: Align } {
  const [side, align] = placement.split('-') as [Side, Align | undefined]
  return { side, align: align ?? 'center' }
}

function place(anchor: Rect, size: { width: number; height: number }, side: Side, align: Align, offset: number): { x: number; y: number } {
  let x = 0
  let y = 0
  if (side === 'bottom' || side === 'top') {
    y = side === 'bottom' ? anchor.top + anchor.height + offset : anchor.top - size.height - offset
    x =
      align === 'start'
        ? anchor.left
        : align === 'end'
          ? anchor.left + anchor.width - size.width
          : anchor.left + anchor.width / 2 - size.width / 2
  } else {
    x = side === 'right' ? anchor.left + anchor.width + offset : anchor.left - size.width - offset
    y =
      align === 'start'
        ? anchor.top
        : align === 'end'
          ? anchor.top + anchor.height - size.height
          : anchor.top + anchor.height / 2 - size.height / 2
  }
  return { x, y }
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/** Positions a floating surface next to an anchor, flipping to the opposite side and clamping to the viewport. */
export function computePosition(
  anchor: Rect,
  size: { width: number; height: number },
  placement: Placement,
  offset = 6
): { x: number; y: number; side: Side } {
  const { side, align } = parse(placement)
  const vw = window.innerWidth
  const vh = window.innerHeight
  let chosen = side
  let pos = place(anchor, size, side, align, offset)

  const overflows = (p: { x: number; y: number }, s: Side): boolean =>
    s === 'bottom'
      ? p.y + size.height > vh - VIEWPORT_PAD
      : s === 'top'
        ? p.y < VIEWPORT_PAD
        : s === 'right'
          ? p.x + size.width > vw - VIEWPORT_PAD
          : p.x < VIEWPORT_PAD

  if (overflows(pos, side)) {
    const flipped = place(anchor, size, OPPOSITE[side], align, offset)
    if (!overflows(flipped, OPPOSITE[side])) {
      pos = flipped
      chosen = OPPOSITE[side]
    }
  }

  return {
    x: Math.min(Math.max(pos.x, VIEWPORT_PAD), Math.max(VIEWPORT_PAD, vw - size.width - VIEWPORT_PAD)),
    y: Math.min(Math.max(pos.y, VIEWPORT_PAD), Math.max(VIEWPORT_PAD, vh - size.height - VIEWPORT_PAD)),
    side: chosen
  }
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}
