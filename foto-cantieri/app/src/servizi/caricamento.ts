import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { ErroreUtente } from '../errori'

const apri = httpsCallable<
  { commessaId: string; sottocartella: string; dimensione: number; larghezza: number; altezza: number; scattataIl: number },
  { idCaricamento: string; urlCaricamento: string }
>(functions, 'apriCaricamento')
const registra = httpsCallable<{ idCaricamento: string; fileId: string }, { fotoId: string }>(functions, 'registraFoto')

/**
 * Invia i byte con una PUT direttamente all'archivio della ditta (Drive o quello di prova):
 * non passano dai nostri server. Restituisce l'id del file creato.
 */
export function inviaByte(url: string, blob: Blob, avanzamento: (frazione: number) => void): Promise<string> {
  return new Promise((risolvi, rifiuta) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', blob.type || 'image/jpeg')
    xhr.upload.onprogress = (e) => e.lengthComputable && avanzamento(e.loaded / e.total)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const { id } = JSON.parse(xhr.responseText) as { id?: string }
          if (id) return risolvi(id)
        } catch {
          // risposta non leggibile: errore sotto
        }
      }
      rifiuta(new ErroreUtente(`Invio non riuscito (codice ${xhr.status}). Riprova.`))
    }
    xhr.onerror = () => rifiuta(new ErroreUtente('Connessione interrotta durante l\'invio. Riprova quando c\'è campo.'))
    xhr.send(blob)
  })
}

export type Fase = 'attesa' | 'compressione' | 'invio' | 'registrazione' | 'fatto' | 'errore'

/** Stato di una foto in coda. Si riprende dall'ultimo passo riuscito. */
export interface FotoInCoda {
  id: string
  originale: File
  fase: Fase
  avanzamento: number
  errore?: string
  anteprima?: string
  compressa?: { blob: Blob; larghezza: number; altezza: number }
  idCaricamento?: string
  urlCaricamento?: string
  fileId?: string
}

export const passi = {
  apri: (commessaId: string, sottocartella: string, f: NonNullable<FotoInCoda['compressa']>, scattataIl: number) =>
    apri({ commessaId, sottocartella, dimensione: f.blob.size, larghezza: f.larghezza, altezza: f.altezza, scattataIl }),
  registra: (idCaricamento: string, fileId: string) => registra({ idCaricamento, fileId }),
}
