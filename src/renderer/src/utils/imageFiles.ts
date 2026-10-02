/** Picture formats the app accepts for dropping / opening. Everything is converted to PNG here. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] as const

const MAX_SIDE = 6000

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext) || ext === 'tif' || ext === 'tiff'
}

/**
 * Decodes any picture the browser engine understands (PNG, JPEG, WebP, BMP, GIF) and re-encodes it
 * as PNG bytes, which is what the main process stores and recognizes. Very large pictures are scaled
 * down so memory stays sane. Throws a readable error for formats that cannot be decoded (e.g. TIFF).
 */
export async function fileToPngBytes(file: Blob): Promise<Uint8Array> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('Не удалось прочитать изображение. Поддерживаются PNG, JPG, WebP, BMP и GIF.')
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не удалось обработать изображение.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Не удалось обработать изображение.')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

/** Image files in a drop / paste event. */
export function imageFilesOf(list: FileList | File[] | null | undefined): File[] {
  return Array.from(list ?? []).filter(isImageFile)
}
