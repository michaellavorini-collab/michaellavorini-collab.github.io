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

/** Apre il caricamento (Function apriCaricamento). */
export async function apriCaricamento(dati: {
  commessaId: string; sottocartella: string; dimensione: number; larghezza: number; altezza: number; scattataIl: number
}) {
  return (await apri(dati)).data
}

/** Registra la foto nell'indice (Function registraFoto). */
export async function registraFoto(idCaricamento: string, fileId: string) {
  return (await registra({ idCaricamento, fileId })).data
}
