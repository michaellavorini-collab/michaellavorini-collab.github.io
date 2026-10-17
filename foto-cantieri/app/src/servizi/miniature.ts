import { auth, URL_FUNZIONI } from '../firebase'
import { ErroreUtente } from '../errori'

export type Misura = 'miniatura' | 'grande'

/**
 * Le immagini arrivano dalla Function "miniatura", che le legge dall'archivio della ditta
 * al momento. Qui restano solo nella memoria della pagina (mai salvate sul telefono o altrove).
 */
const inMemoria = new Map<string, Promise<string>>()
const MASSIMO_IN_MEMORIA = 150

// Al massimo 4 richieste insieme, per non intasare la rete del cantiere.
const IN_PARALLELO = 4
let attive = 0
const inAttesa: (() => void)[] = []
async function turno<T>(lavoro: () => Promise<T>): Promise<T> {
  if (attive >= IN_PARALLELO) await new Promise<void>((ok) => inAttesa.push(ok))
  attive++
  try {
    return await lavoro()
  } finally {
    attive--
    inAttesa.shift()?.()
  }
}

async function scarica(fotoId: string, misura: Misura): Promise<string> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new ErroreUtente('Accesso scaduto: rientra.')
  const q = new URLSearchParams({ foto: fotoId, ...(misura === 'grande' ? { misura } : {}) })
  const r = await fetch(`${URL_FUNZIONI}/miniatura?${q}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new ErroreUtente(r.status === 404 ? 'Foto non più disponibile.' : 'Immagine non caricata.')
  return URL.createObjectURL(await r.blob())
}

/** Indirizzo locale (blob:) dell'immagine, da usare in <img src>. */
export function immagine(fotoId: string, misura: Misura = 'miniatura'): Promise<string> {
  const chiave = `${misura}:${fotoId}`
  let p = inMemoria.get(chiave)
  if (!p) {
    p = turno(() => scarica(fotoId, misura))
    // In caso di errore si potrà riprovare.
    p.catch(() => inMemoria.delete(chiave))
    inMemoria.set(chiave, p)
    if (inMemoria.size > MASSIMO_IN_MEMORIA) {
      const [vecchia, promessa] = inMemoria.entries().next().value as [string, Promise<string>]
      inMemoria.delete(vecchia)
      void promessa.then((u) => URL.revokeObjectURL(u), () => undefined)
    }
  }
  return p
}

/** All'uscita (logout) si libera tutto. */
export function svuotaImmagini() {
  for (const p of inMemoria.values()) void p.then((u) => URL.revokeObjectURL(u), () => undefined)
  inMemoria.clear()
}
