import { memo, type ReactElement } from 'react'
import { highlightParts, type Range } from '@shared/noteSearch'

/** Text with the searched words marked. Built from plain pieces: no HTML is ever injected. */
function HighlightImpl({ text, ranges }: { text: string; ranges?: Range[] }): ReactElement {
  if (!ranges || ranges.length === 0) return <>{text}</>
  return (
    <>
      {highlightParts(text, ranges).map((part, i) =>
        part.hit ? (
          <mark key={i} className="search-hit">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  )
}

export const Highlight = memo(HighlightImpl)
