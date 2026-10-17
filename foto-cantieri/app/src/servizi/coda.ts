import { useSyncExternalStore } from 'react'
import { FirebaseError } from 'firebase/app'
import { comprimiFoto } from './compressione'
import { apriCaricamento, inviaByte, registraFoto } from './caricamento'
import { memoria } from './memoria'
import { messaggioErrore } from '../errori'

export type Fase =
  | 'compressione' // ancora solo in memoria: non chiudere l'app
  | 'attesa' // salvata sul telefono, in coda
  | 'invio'
  | 'registrazione'
  | 'riprova' // problema temporaneo (rete): si ritenta da sola
  | 'errore' // problema da risolvere: serve "Riprova" o "Elimina"
  | 'fatto'

/** Foto in coda. Ciò che serve a riprendere viene salvato sul telefono. */
export interface VoceCoda {
  id: string
  uid: string
  commessaId: string
  sottocartella: string
  scattataIl: number
  creataIl: number
  fase: Fase
  blob?: Blob
  larghezza?: number
  altezza?: number
  idCaricamento?: string
  urlCaricamento?: string
  fileId?: string
  avanzamento: number
  errore?: string
  tentativi: number
  prossimoTentativo?: number
}

/** Attese tra un tentativo automatico e l'altro (poi resta sull'ultima). */
const ATTESE_SECONDI = [5, 15, 30, 60, 120, 300]

/** Errori che non si risolvono riprovando da soli (commessa chiusa, accesso disattivato…). */
const DEFINITIVI = new Set([
  'functions/permission-denied', 'functions/failed-precondition', 'functions/invalid-argument',
  'functions/not-found', 'functions/unauthenticated',
])
/** In registrazione: il caricamento aperto non vale più (scaduto, perso, file non corrispondente). */
const DA_RIAPRIRE = new Set(['functions/deadline-exceeded', 'functions/not-found', 'functions/failed-precondition'])
const DA_CAPO = { urlCaricamento: undefined, idCaricamento: undefined, fileId: undefined }

type Ascoltatore = () => void

class Coda {
  private voci = new Map<string, VoceCoda>()
  private anteprime = new Map<string, string>()
  private ascoltatori = new Set<Ascoltatore>()
  private uid: string | null = null
  private inLavoro = false
  private sveglia: ReturnType<typeof setTimeout> | null = null
  private istantanea: VoceCoda[] = []

  constructor() {
    window.addEventListener('online', () => this.riprovaTemporanee())
  }

  // ---- Stato per React ----
  iscrivi = (f: Ascoltatore) => {
    this.ascoltatori.add(f)
    return () => this.ascoltatori.delete(f)
  }
  elenco = () => this.istantanea
  anteprima(id: string): string | undefined {
    const v = this.voci.get(id)
    if (!v?.blob) return undefined
    let u = this.anteprime.get(id)
    if (!u) {
      u = URL.createObjectURL(v.blob)
      this.anteprime.set(id, u)
    }
    return u
  }
  private avvisa() {
    this.istantanea = [...this.voci.values()].sort((a, b) => b.creataIl - a.creataIl)
    this.ascoltatori.forEach((f) => f())
  }

  // ---- Avvio e uscita ----
  /** All'accesso: riprende le foto di questo utente rimaste sul telefono. */
  async avvia(uid: string) {
    if (this.uid === uid) return
    this.ferma()
    this.uid = uid
    const salvate = (await memoria.tutte<VoceCoda>()).filter((v) => v.uid === uid)
    if (this.uid !== uid) return
    for (const v of salvate) {
      // Un invio interrotto dalla chiusura dell'app riparte dall'ultimo passo salvato.
      const fase: Fase = v.fase === 'errore' ? 'errore' : 'attesa'
      this.voci.set(v.id, { ...v, fase, avanzamento: 0, prossimoTentativo: undefined })
    }
    this.avvisa()
    void this.lavora()
  }

  /** All'uscita: si smette di inviare; le foto restano sul telefono per il prossimo accesso. */
  ferma() {
    this.uid = null
    if (this.sveglia) clearTimeout(this.sveglia)
    this.anteprime.forEach((u) => URL.revokeObjectURL(u))
    this.anteprime.clear()
    this.voci.clear()
    this.avvisa()
  }

  // ---- Azioni ----
  async aggiungi(file: File, commessaId: string, sottocartella: string) {
    const uid = this.uid
    if (!uid) return
    const v: VoceCoda = {
      id: crypto.randomUUID(), uid, commessaId, sottocartella,
      scattataIl: file.lastModified || Date.now(), creataIl: Date.now(),
      fase: 'compressione', avanzamento: 0, tentativi: 0,
    }
    this.voci.set(v.id, v)
    this.avvisa()
    try {
      const c = await comprimiFoto(file)
      await this.aggiorna(v.id, { fase: 'attesa', blob: c.blob, larghezza: c.larghezza, altezza: c.altezza }, true)
    } catch (e) {
      await this.aggiorna(v.id, { fase: 'errore', errore: `Foto non leggibile: ${messaggioErrore(e)}` })
    }
    void this.lavora()
  }

  riprova(id: string) {
    void this.aggiorna(id, { fase: 'attesa', errore: undefined, tentativi: 0, prossimoTentativo: undefined }, true)
    void this.lavora()
  }

  async elimina(id: string) {
    this.voci.delete(id)
    const u = this.anteprime.get(id)
    if (u) URL.revokeObjectURL(u)
    this.anteprime.delete(id)
    await memoria.elimina(id)
    this.avvisa()
  }

  // ---- Motore ----
  private async aggiorna(id: string, modifica: Partial<VoceCoda>, salva = false) {
    const v = this.voci.get(id)
    if (!v) return
    const nuova = { ...v, ...modifica }
    this.voci.set(id, nuova)
    this.avvisa()
    if (salva) await memoria.salva({ ...nuova, avanzamento: 0 })
  }

  private riprovaTemporanee() {
    for (const v of this.voci.values()) if (v.fase === 'riprova') v.prossimoTentativo = 0
    void this.lavora()
  }

  private prossima(): VoceCoda | undefined {
    const ora = Date.now()
    return [...this.voci.values()]
      .filter((v) => v.fase === 'attesa' || (v.fase === 'riprova' && (v.prossimoTentativo ?? 0) <= ora))
      .sort((a, b) => a.creataIl - b.creataIl)[0]
  }

  /** Una foto alla volta, in ordine di scatto. */
  private async lavora() {
    if (this.inLavoro) return
    this.inLavoro = true
    try {
      for (let v = this.prossima(); v && this.uid; v = this.prossima()) {
        if (!navigator.onLine) {
          await this.aggiorna(v.id, { fase: 'riprova', errore: 'Nessuna connessione: partirà quando torna il campo.', prossimoTentativo: Infinity })
          continue
        }
        await this.invia(v)
      }
    } finally {
      this.inLavoro = false
    }
    this.programmaSveglia()
  }

  private programmaSveglia() {
    if (this.sveglia) clearTimeout(this.sveglia)
    const attese = [...this.voci.values()].filter((v) => v.fase === 'riprova' && Number.isFinite(v.prossimoTentativo))
    if (!attese.length) return
    const quando = Math.min(...attese.map((v) => v.prossimoTentativo!))
    this.sveglia = setTimeout(() => void this.lavora(), Math.max(0, quando - Date.now()))
  }

  private async invia(voce: VoceCoda) {
    let v = voce
    try {
      if (!v.fileId) {
        await this.aggiorna(v.id, { fase: 'invio', avanzamento: 0, errore: undefined })
        if (!v.urlCaricamento) {
          const aperto = await apriCaricamento({
            commessaId: v.commessaId, sottocartella: v.sottocartella, dimensione: v.blob!.size,
            larghezza: v.larghezza!, altezza: v.altezza!, scattataIl: v.scattataIl,
          })
          await this.aggiorna(v.id, aperto, true)
          v = { ...v, ...aperto }
        }
        const fileId = await inviaByte(v.urlCaricamento!, v.blob!, (a) => void this.aggiorna(v.id, { avanzamento: a }))
        await this.aggiorna(v.id, { fileId }, true)
        v = { ...v, fileId }
      }
      await this.aggiorna(v.id, { fase: 'registrazione', errore: undefined })
      await registraFoto(v.idCaricamento!, v.fileId!)
      // Salvata nell'archivio: si toglie dal telefono (resta in elenco fino all'uscita).
      await memoria.elimina(v.id)
      await this.aggiorna(v.id, { fase: 'fatto', avanzamento: 1 })
    } catch (e) {
      const codice = e instanceof FirebaseError ? e.code : ''
      const tentativi = v.tentativi + 1
      const dopoInvio = Boolean(v.fileId)
      // Dopo l'invio, se il caricamento non vale più (scaduto, file non corrispondente),
      // si rimanda la foto da capo: è ancora sul telefono. Al massimo 3 volte.
      if (dopoInvio && DA_RIAPRIRE.has(codice) && tentativi <= 3) {
        await this.aggiorna(v.id, { ...DA_CAPO, fase: 'attesa', errore: undefined, tentativi }, true)
        return
      }
      // Prima dell'invio si riparte sempre da "apri"; dopo, si rifà solo la registrazione.
      const azzera = dopoInvio && !DA_RIAPRIRE.has(codice) ? {} : DA_CAPO
      if (DEFINITIVI.has(codice) || (dopoInvio && DA_RIAPRIRE.has(codice))) {
        await this.aggiorna(v.id, { ...azzera, fase: 'errore', errore: messaggioErrore(e), tentativi }, true)
        return
      }
      const attesa = ATTESE_SECONDI[Math.min(tentativi - 1, ATTESE_SECONDI.length - 1)]
      await this.aggiorna(v.id, {
        ...azzera, fase: 'riprova', tentativi,
        errore: `${messaggioErrore(e)} Nuovo tentativo tra ${attesa < 60 ? `${attesa} secondi` : `${attesa / 60} minuti`}.`,
        prossimoTentativo: Date.now() + attesa * 1000,
      }, true)
    }
  }
}

export const coda = new Coda()

/** Elenco delle foto in coda (si aggiorna da solo). */
export function useCoda(): VoceCoda[] {
  return useSyncExternalStore(coda.iscrivi, coda.elenco)
}
