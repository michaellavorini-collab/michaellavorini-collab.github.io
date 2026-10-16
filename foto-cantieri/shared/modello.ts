/**
 * Modello dati di Foto Cantieri, condiviso tra app e Functions.
 *
 * Su Firestore restano solo dati gestionali e l'indice dei file:
 * le foto vivono nel Drive/OneDrive della ditta.
 *
 *   ditte/{dittaId}                         Ditta
 *   ditte/{dittaId}/operatori/{operatoreId} Operatore
 *   ditte/{dittaId}/commesse/{commessaId}   Commessa
 *   ditte/{dittaId}/foto/{fotoId}           Foto (indice)
 *
 * Raccolte riservate alle Functions (le regole negano tutto ai client):
 *   titolari/{uid}                          { dittaId }
 *   codiciDitta/{codiceDitta}               CodiceDitta
 *   codiciOperatore/{impronta}              CodiceOperatore
 *   credenzialiArchivio/{dittaId}           CredenzialiArchivio
 *   tentativiAccesso/{chiave}               TentativiAccesso
 */

/** Data come la vede chi legge: Timestamp di Firestore lato client o admin. */
export interface Istante {
  toDate(): Date
  toMillis(): number
}

export type Ruolo = 'titolare' | 'operatore'

/** Attributi personalizzati del token Firebase (custom claims). */
export interface AttributiToken {
  dittaId: string
  ruolo: Ruolo
  /** Solo per gli operatori. */
  operatoreId?: string
}

export type TipoArchivio = 'nessuno' | 'simulato' | 'googleDrive' | 'oneDrive'
export type StatoArchivio = 'scollegato' | 'collegato' | 'errore'

export interface InfoArchivio {
  tipo: TipoArchivio
  stato: StatoArchivio
  /** Account collegato (es. email Google), solo per mostrarlo al titolare. */
  account?: string
  /** Id della cartella "Foto Cantieri" nell'archivio della ditta. */
  cartellaRadiceId?: string
  collegatoIl?: Istante
}

export interface Ditta {
  nome: string
  /** Codice che gli operatori digitano per accedere, es. "TMK4F2". */
  codiceDitta: string
  titolareUid: string
  titolareEmail: string
  /** Sottocartelle proposte dentro ogni commessa, es. "Prima", "Durante". */
  sottocartelle: string[]
  archivio: InfoArchivio
  creataIl: Istante
  aggiornataIl: Istante
}

export interface Operatore {
  nome: string
  attivo: boolean
  /** Il codice personale NON si salva qui: solo la sua impronta in codiciOperatore. */
  creatoIl: Istante
  aggiornatoIl: Istante
}

export interface Commessa {
  numero: string
  descrizione: string
  cliente: string
  attiva: boolean
  /** Cartella della commessa nell'archivio, scritta solo dalle Functions. */
  cartellaArchivioId?: string
  creataIl: Istante
  aggiornataIl: Istante
}

/** Voce dell'indice: dove sta il file, chi l'ha caricato e quando. */
export interface Foto {
  commessaId: string
  sottocartella: string
  archivio: TipoArchivio
  fileId: string
  cartellaId: string
  nomeFile: string
  mimeType: string
  dimensione: number
  larghezza: number
  altezza: number
  caricataDaUid: string
  /** Assente se ha caricato il titolare. */
  operatoreId?: string
  /** Nome copiato al momento del caricamento, per la galleria. */
  autore: string
  scattataIl: Istante
  caricataIl: Istante
}

export interface CodiceDitta {
  dittaId: string
}

export interface CodiceOperatore {
  dittaId: string
  operatoreId: string
}

export interface CredenzialiArchivio {
  tipo: TipoArchivio
  /** Token di accesso cifrati (AES-256-GCM), base64. */
  cifrato: string
  aggiornateIl: Istante
}

export interface TentativiAccesso {
  falliti: number
  bloccatoFinoA?: Istante
  ultimoIl: Istante
}

// ---- Costanti e controlli condivisi ----

export const SOTTOCARTELLE_PREDEFINITE = ['Prima', 'Durante', 'Dopo', 'Varie']

/** Codice ditta: 6 caratteri, senza 0/O e 1/I/L per non confondersi. */
export const ALFABETO_CODICE_DITTA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const LUNGHEZZA_CODICE_DITTA = 6
/** Codice personale operatore: da 4 a 6 cifre. */
export const CODICE_OPERATORE = /^[0-9]{4,6}$/

export const LIMITI = {
  nomeDitta: 80,
  nomeOperatore: 60,
  numeroCommessa: 30,
  descrizioneCommessa: 200,
  clienteCommessa: 120,
  sottocartella: 40,
  sottocartelleMax: 20,
} as const

export function normalizzaCodiceDitta(testo: string): string {
  return testo.trim().toUpperCase().replace(/[\s-]/g, '')
}

export function codiceDittaValido(codice: string): boolean {
  if (codice.length !== LUNGHEZZA_CODICE_DITTA) return false
  return [...codice].every((c) => ALFABETO_CODICE_DITTA.includes(c))
}
