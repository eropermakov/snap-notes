/**
 * Images of a note live in a per-note folder (snap-media://<noteId>/<imageId>.png). Duplicating a
 * note therefore needs its own copies of the files and every reference rewritten to the new note.
 */

const REF = /snap-media:\/\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\.png/g

/** Ids of the images of `noteId` that the HTML references. */
export function collectImageIds(html: string, noteId: string): string[] {
  const ids = new Set<string>()
  for (const match of html.matchAll(REF)) if (match[1] === noteId) ids.add(match[2])
  return [...ids]
}

/** Rewrites references to `fromNote`'s images so they point to `toNote`'s copies (`idMap` old → new). */
export function rewriteImageRefs(html: string, fromNote: string, toNote: string, idMap: ReadonlyMap<string, string>): string {
  return html.replace(REF, (whole, note: string, image: string) => {
    if (note !== fromNote) return whole
    return `snap-media://${toNote}/${idMap.get(image) ?? image}.png`
  })
}
