import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Timestamp } from 'firebase-admin/firestore'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  admin, chiudiClient, entraComeOperatore, erroreDi, svuotaEmulatori, titolareConDitta,
} from './aiuti'
import { cifra } from '../functions/src/cifratura'
import { esitoConferma, improntaConferma } from '../functions/src/drive/collegamento'

/** La chiave locale degli emulatori, per preparare un collegamento in attesa come farebbe driveRitorno. */
const CHIAVE = /^CHIAVE_CIFRATURA_ARCHIVIO=(.+)$/m.exec(
  readFileSync(join(import.meta.dirname, '..', 'functions', '.secret.local'), 'utf8'),
)![1].trim()

const RITORNO = 'http://127.0.0.1:5001/demo-foto-cantieri/europe-west1/driveRitorno'
const CARTELLA_SIMULATA = join(import.meta.dirname, '..', '.archivio-simulato')

beforeEach(svuotaEmulatori)
afterEach(chiudiClient)

describe('driveAvviaCollegamento', () => {
  it('senza client OAuth configurato lo dice chiaramente', async () => {
    const { client } = await titolareConDitta('t@ditta.it')
    const e = await erroreDi(client.chiama('driveAvviaCollegamento'))
    expect(e.code).toBe('functions/failed-precondition')
    expect(e.message).toMatch(/non è ancora configurato/)
  })

  it("l'operatore non può collegare Drive", async () => {
    const { client, codiceDitta } = await titolareConDitta('t@ditta.it')
    const { codice } = await client.chiama<{ codice: string }>('creaOperatore', { nome: 'Mario' })
    const op = await entraComeOperatore(codiceDitta, codice)
    for (const nome of ['driveAvviaCollegamento', 'driveConfermaCollegamento', 'collegaArchivioSimulato', 'scollegaArchivio']) {
      expect((await erroreDi(op.chiama(nome))).code).toBe('functions/permission-denied')
    }
  })
})

describe('driveRitorno', () => {
  async function statoInCorso(dittaId: string, uid: string, scadeTraMinuti = 10) {
    const stato = 'S'.repeat(40) + Math.random().toString(36).slice(2, 10)
    await admin.db.doc(`collegamentiInCorso/${stato}`).set({
      dittaId, uid, origine: 'http://localhost:5173', scadeIl: Timestamp.fromMillis(Date.now() + scadeTraMinuti * 60_000),
    })
    return stato
  }
  const ritorno = (q: Record<string, string>) => fetch(`${RITORNO}?${new URLSearchParams(q)}`, { redirect: 'manual' })

  it('rifiuta uno stato inventato', async () => {
    const r = await ritorno({ state: 'inventato-ma-lungo-abbastanza-1234', code: 'x' })
    expect(r.status).toBe(400)
    expect(await r.text()).toMatch(/scaduto o è già stato usato/)
    expect((await ritorno({ state: '<script>', code: 'x' })).status).toBe(400)
  })

  it("se il titolare annulla su Google torna all'app; lo stato vale una volta sola", async () => {
    const { client, dittaId } = await titolareConDitta('t@ditta.it')
    const stato = await statoInCorso(dittaId, client.auth.currentUser!.uid)
    const r = await ritorno({ state: stato, error: 'access_denied' })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('http://localhost:5173/?drive=annullato')
    expect((await admin.db.doc(`collegamentiInCorso/${stato}`).get()).exists).toBe(false)
    expect((await ritorno({ state: stato, error: 'access_denied' })).status).toBe(400)
  })

  it('rifiuta uno stato scaduto', async () => {
    const { client, dittaId } = await titolareConDitta('t@ditta.it')
    const stato = await statoInCorso(dittaId, client.auth.currentUser!.uid, -1)
    expect((await ritorno({ state: stato, code: 'x' })).status).toBe(400)
  })

  it('rifiuta se chi ha avviato non è il titolare di quella ditta', async () => {
    const a = await titolareConDitta('a@ditta.it', 'A')
    const b = await titolareConDitta('b@ditta.it', 'B')
    const stato = await statoInCorso(a.dittaId, b.client.auth.currentUser!.uid)
    const r = await ritorno({ state: stato, code: 'x' })
    expect(r.headers.get('location')).toBe('http://localhost:5173/?drive=errore')
    expect((await admin.db.doc(`credenzialiArchivio/${a.dittaId}`).get()).exists).toBe(false)
  })
})

describe('driveConfermaCollegamento (il link vale solo per chi l\'ha avviato)', () => {
  /** Come lo lascia driveRitorno dopo il consenso su Google. */
  async function inAttesa(dittaId: string, uid: string, scadeTraMinuti = 10) {
    const conferma = 'C'.repeat(30) + Math.random().toString(36).slice(2, 12)
    await admin.db.doc(`collegamentiDaConfermare/${improntaConferma(conferma)}`).set({
      dittaId, uid, cifrato: cifra('1//refresh-di-prova', dittaId, CHIAVE),
      scadeIl: Timestamp.fromMillis(Date.now() + scadeTraMinuti * 60_000),
    })
    return conferma
  }
  const rifAttesa = (c: string) => admin.db.doc(`collegamentiDaConfermare/${improntaConferma(c)}`)

  it("un altro titolare (es. chi riceve un link inoltrato) non può confermare: si annulla", async () => {
    const a = await titolareConDitta('a@ditta.it', 'A')
    const vittima = await titolareConDitta('vittima@ditta.it', 'Vittima')
    const conferma = await inAttesa(a.dittaId, a.client.auth.currentUser!.uid)
    const e = await erroreDi(vittima.client.chiama('driveConfermaCollegamento', { conferma }))
    expect(e.code).toBe('functions/permission-denied')
    expect(e.message).toMatch(/altro account/)
    // Annullato per tutti: nemmeno chi l'ha avviato può più usarlo.
    expect((await rifAttesa(conferma).get()).exists).toBe(false)
    expect((await erroreDi(a.client.chiama('driveConfermaCollegamento', { conferma }))).code).toBe('functions/not-found')
    for (const d of [a.dittaId, vittima.dittaId]) {
      expect((await admin.db.doc(`credenzialiArchivio/${d}`).get()).exists).toBe(false)
      expect((await admin.db.doc(`ditte/${d}`).get()).get('archivio.stato')).toBe('scollegato')
    }
  })

  it('codice di conferma sconosciuto o non valido', async () => {
    const { client } = await titolareConDitta('t@ditta.it')
    expect((await erroreDi(client.chiama('driveConfermaCollegamento', { conferma: 'x'.repeat(40) }))).code).toBe('functions/not-found')
    expect((await erroreDi(client.chiama('driveConfermaCollegamento', { conferma: '<>' }))).code).toBe('functions/invalid-argument')
  })

  it('conferma scaduta', async () => {
    const { client, dittaId } = await titolareConDitta('t@ditta.it')
    const conferma = await inAttesa(dittaId, client.auth.currentUser!.uid, -1)
    expect((await erroreDi(client.chiama('driveConfermaCollegamento', { conferma }))).code).toBe('functions/deadline-exceeded')
    expect((await rifAttesa(conferma).get()).exists).toBe(false)
  })

  it('regola di conferma', () => {
    const voce = { uid: 'u1', dittaId: 'd1', scadeIl: Timestamp.fromMillis(2_000) }
    expect(esitoConferma(voce, 'u1', 'd1', 1_000)).toBe('ok')
    expect(esitoConferma(voce, 'u2', 'd1', 1_000)).toBe('altro-account')
    expect(esitoConferma(voce, 'u1', 'd2', 1_000)).toBe('altro-account')
    expect(esitoConferma(voce, 'u1', 'd1', 3_000)).toBe('scaduta')
  })
})

describe('archivio simulato (solo sviluppo)', () => {
  it('collega l\'archivio e crea la cartella "Foto Cantieri"', async () => {
    const { client, dittaId } = await titolareConDitta('t@ditta.it')
    const { cartellaRadiceId } = await client.chiama<{ cartellaRadiceId: string }>('collegaArchivioSimulato')

    const archivio = (await admin.db.doc(`ditte/${dittaId}`).get()).get('archivio')
    expect(archivio).toMatchObject({ tipo: 'simulato', stato: 'collegato', cartellaRadiceId })
    expect(existsSync(join(CARTELLA_SIMULATA, dittaId, 'Foto Cantieri'))).toBe(true)

    // Ricollegando si riusa la stessa cartella.
    const di_nuovo = await client.chiama<{ cartellaRadiceId: string }>('collegaArchivioSimulato')
    expect(di_nuovo.cartellaRadiceId).toBe(cartellaRadiceId)
  })

  it('scollegare cancella le credenziali e ricorda la cartella', async () => {
    const { client, dittaId } = await titolareConDitta('t@ditta.it')
    const { cartellaRadiceId } = await client.chiama<{ cartellaRadiceId: string }>('collegaArchivioSimulato')
    await admin.db.doc(`credenzialiArchivio/${dittaId}`).set({ tipo: 'simulato', cifrato: 'x' })
    await client.chiama('scollegaArchivio')
    const archivio = (await admin.db.doc(`ditte/${dittaId}`).get()).get('archivio')
    expect(archivio).toMatchObject({ tipo: 'simulato', stato: 'scollegato', cartellaRadiceId })
    expect((await admin.db.doc(`credenzialiArchivio/${dittaId}`).get()).exists).toBe(false)
  })
})
