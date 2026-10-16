/** Lato lungo massimo della foto salvata, in pixel. */
export const LATO_MASSIMO = 1600
/** Qualità JPEG (0–1): buon compromesso tra dettaglio e peso (di solito 250–600 KB). */
export const QUALITA_JPEG = 0.82

export interface FotoCompressa {
  blob: Blob
  larghezza: number
  altezza: number
}

/** Apre l'immagine rispettando l'orientamento della fotocamera (EXIF). */
async function apriImmagine(file: Blob): Promise<{ sorgente: CanvasImageSource; larghezza: number; altezza: number; chiudi(): void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { sorgente: bmp, larghezza: bmp.width, altezza: bmp.height, chiudi: () => bmp.close() }
  } catch {
    // Browser più vecchi: si passa da un <img>, che applica già l'orientamento.
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    await img.decode()
    return { sorgente: img, larghezza: img.naturalWidth, altezza: img.naturalHeight, chiudi: () => URL.revokeObjectURL(url) }
  }
}

/**
 * Riduce la foto a circa 1600 px sul lato lungo e la salva in JPEG, tutto sul telefono.
 * Il ridisegno su canvas toglie anche i dati EXIF (compresa la posizione GPS).
 */
export async function comprimiFoto(file: Blob): Promise<FotoCompressa> {
  const img = await apriImmagine(file)
  try {
    const scala = Math.min(1, LATO_MASSIMO / Math.max(img.larghezza, img.altezza))
    const larghezza = Math.max(1, Math.round(img.larghezza * scala))
    const altezza = Math.max(1, Math.round(img.altezza * scala))
    const canvas = document.createElement('canvas')
    canvas.width = larghezza
    canvas.height = altezza
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas non disponibile')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img.sorgente, 0, 0, larghezza, altezza)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', QUALITA_JPEG))
    if (!blob) throw new Error('Compressione non riuscita')
    return { blob, larghezza, altezza }
  } finally {
    img.chiudi()
  }
}
