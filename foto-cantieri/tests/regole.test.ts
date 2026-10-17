import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let amb: RulesTestEnvironment

const ORA = Timestamp.fromDate(new Date('2026-10-01T08:00:00Z'))

beforeAll(async () => {
  amb = await initializeTestEnvironment({
    projectId: 'demo-foto-cantieri',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})

afterAll(() => amb.cleanup())

/** Due ditte complete, scritte senza regole come farebbero le Functions. */
beforeEach(async () => {
  await amb.clearFirestore()
  await amb.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const d of ['A', 'B']) {
      await setDoc(doc(db, `ditte/ditta${d}`), {
        nome: `Ditta ${d}`,
        codiceDitta: `COD${d}23`,
        titolareUid: `titolare${d}`,
        titolareEmail: `titolare${d}@esempio.it`,
        sottocartelle: ['Prima', 'Dopo'],
        archivio: { tipo: 'nessuno', stato: 'scollegato' },
        creataIl: ORA,
        aggiornataIl: ORA,
      })
      await setDoc(doc(db, `ditte/ditta${d}/operatori/mario`), { nome: 'Mario', attivo: true, creatoIl: ORA, aggiornatoIl: ORA })
      await setDoc(doc(db, `ditte/ditta${d}/operatori/luigi`), { nome: 'Luigi', attivo: false, creatoIl: ORA, aggiornatoIl: ORA })
      await setDoc(doc(db, `ditte/ditta${d}/commesse/c1`), {
        numero: '2026-001', descrizione: 'Caldaia', cliente: 'Rossi', attiva: true, creataIl: ORA, aggiornataIl: ORA,
      })
      await setDoc(doc(db, `ditte/ditta${d}/commesse/c2`), {
        numero: '2025-099', descrizione: 'Chiusa', cliente: 'Bianchi', attiva: false, creataIl: ORA, aggiornataIl: ORA,
      })
      await setDoc(doc(db, `ditte/ditta${d}/foto/f1`), {
        commessaId: 'c1', sottocartella: 'Prima', archivio: 'simulato', fileId: 'file1', cartellaId: 'cart1',
        nomeFile: 'f1.jpg', mimeType: 'image/jpeg', dimensione: 1000, larghezza: 1600, altezza: 1200,
        caricataDaUid: 'op', operatoreId: 'mario', autore: 'Mario', scattataIl: ORA, caricataIl: ORA,
      })
    }
    await setDoc(doc(db, 'codiciDitta/CODA23'), { dittaId: 'dittaA' })
    await setDoc(doc(db, 'codiciOperatore/impronta'), { dittaId: 'dittaA', operatoreId: 'mario' })
    await setDoc(doc(db, 'credenzialiArchivio/dittaA'), { tipo: 'googleDrive', cifrato: 'xxx', aggiornateIl: ORA })
  })
})

const titolareA = (): Firestore =>
  amb.authenticatedContext('titolareA', { dittaId: 'dittaA', ruolo: 'titolare' }).firestore() as unknown as Firestore
const operatore = (operatoreId: string, dittaId = 'dittaA'): Firestore =>
  amb.authenticatedContext(`op_${dittaId}_${operatoreId}`, { dittaId, ruolo: 'operatore', operatoreId }).firestore() as unknown as Firestore
const anonimo = (): Firestore => amb.unauthenticatedContext().firestore() as unknown as Firestore
const senzaDitta = (): Firestore => amb.authenticatedContext('nuovo').firestore() as unknown as Firestore

const commessaNuova = () => ({
  numero: '2026-010', descrizione: 'Impianto elettrico', cliente: 'Verdi', attiva: true,
  creataIl: serverTimestamp(), aggiornataIl: serverTimestamp(),
})

describe('accesso senza ditta', () => {
  it('chi non ha fatto login non legge nulla', async () => {
    await assertFails(getDoc(doc(anonimo(), 'ditte/dittaA')))
    await assertFails(getDocs(collection(anonimo(), 'ditte/dittaA/commesse')))
  })

  it('un utente loggato senza ditta non legge nulla', async () => {
    await assertFails(getDoc(doc(senzaDitta(), 'ditte/dittaA')))
  })

  it('nessun client può creare una ditta (passa dalla Function)', async () => {
    await assertFails(setDoc(doc(senzaDitta(), 'ditte/nuova'), { nome: 'X' }))
    await assertFails(setDoc(doc(titolareA(), 'ditte/nuova'), { nome: 'X' }))
  })
})

describe('isolamento tra ditte', () => {
  it('il titolare A legge la propria ditta ma non la B', async () => {
    await assertSucceeds(getDoc(doc(titolareA(), 'ditte/dittaA')))
    await assertFails(getDoc(doc(titolareA(), 'ditte/dittaB')))
  })

  it('il titolare A non legge né scrive commesse, operatori e foto della B', async () => {
    const db = titolareA()
    await assertFails(getDocs(collection(db, 'ditte/dittaB/commesse')))
    await assertFails(getDocs(collection(db, 'ditte/dittaB/operatori')))
    await assertFails(getDocs(collection(db, 'ditte/dittaB/foto')))
    await assertFails(setDoc(doc(db, 'ditte/dittaB/commesse/nuova'), commessaNuova()))
    await assertFails(updateDoc(doc(db, 'ditte/dittaB/operatori/mario'), { attivo: false, aggiornatoIl: serverTimestamp() }))
  })

  it("l'operatore della A non legge la B", async () => {
    const db = operatore('mario')
    await assertFails(getDoc(doc(db, 'ditte/dittaB')))
    await assertFails(getDocs(query(collection(db, 'ditte/dittaB/commesse'), where('attiva', '==', true))))
    await assertFails(getDocs(collection(db, 'ditte/dittaB/foto')))
  })

  it("un operatore con l'id di un operatore della B non entra nella B", async () => {
    // Mario esiste anche nella B, ma il token dice dittaA.
    await assertFails(getDoc(doc(operatore('mario', 'dittaA'), 'ditte/dittaB/commesse/c1')))
  })
})

describe('titolare', () => {
  it('modifica nome e sottocartelle della ditta', async () => {
    await assertSucceeds(updateDoc(doc(titolareA(), 'ditte/dittaA'), {
      nome: 'Ditta A srl', sottocartelle: ['Prima', 'Durante', 'Dopo'], aggiornataIl: serverTimestamp(),
    }))
  })

  it('non cambia codice ditta, titolare o archivio', async () => {
    const db = titolareA()
    await assertFails(updateDoc(doc(db, 'ditte/dittaA'), { codiceDitta: 'ZZZZZZ', aggiornataIl: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'ditte/dittaA'), { titolareUid: 'altro', aggiornataIl: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'ditte/dittaA'), { 'archivio.stato': 'collegato', aggiornataIl: serverTimestamp() }))
  })

  it('crea, modifica e disattiva commesse valide', async () => {
    const db = titolareA()
    await assertSucceeds(setDoc(doc(db, 'ditte/dittaA/commesse/nuova'), commessaNuova()))
    await assertSucceeds(updateDoc(doc(db, 'ditte/dittaA/commesse/c1'), { attiva: false, aggiornataIl: serverTimestamp() }))
  })

  it('rifiuta commesse non valide', async () => {
    const db = titolareA()
    const rif = doc(db, 'ditte/dittaA/commesse/nuova')
    await assertFails(setDoc(rif, { ...commessaNuova(), numero: '' }))
    await assertFails(setDoc(rif, { ...commessaNuova(), attiva: 'sì' }))
    await assertFails(setDoc(rif, { ...commessaNuova(), cartellaArchivioId: 'abc' }))
    await assertFails(setDoc(rif, { ...commessaNuova(), creataIl: ORA }))
    const { cliente: _, ...senzaCliente } = commessaNuova()
    await assertFails(setDoc(rif, senzaCliente))
    await assertFails(updateDoc(doc(db, 'ditte/dittaA/commesse/c1'), { cartellaArchivioId: 'abc', aggiornataIl: serverTimestamp() }))
  })

  it('non cancella le commesse', async () => {
    await assertFails(deleteDoc(doc(titolareA(), 'ditte/dittaA/commesse/c1')))
  })

  it('vede tutti gli operatori e li rinomina, ma non li crea né li disattiva dal client', async () => {
    const db = titolareA()
    await assertSucceeds(getDocs(collection(db, 'ditte/dittaA/operatori')))
    await assertSucceeds(updateDoc(doc(db, 'ditte/dittaA/operatori/mario'), { nome: 'Mario R.', aggiornatoIl: serverTimestamp() }))
    // Disattivare passa dalla Function, che revoca anche le sessioni.
    await assertFails(updateDoc(doc(db, 'ditte/dittaA/operatori/mario'), { attivo: false, aggiornatoIl: serverTimestamp() }))
    await assertFails(setDoc(doc(db, 'ditte/dittaA/operatori/nuovo'), {
      nome: 'Nuovo', attivo: true, creatoIl: serverTimestamp(), aggiornatoIl: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(db, 'ditte/dittaA/operatori/mario'), { codice: '1234', aggiornatoIl: serverTimestamp() }))
  })

  it("legge l'indice foto ma non lo scrive", async () => {
    const db = titolareA()
    await assertSucceeds(getDocs(collection(db, 'ditte/dittaA/foto')))
    await assertFails(setDoc(doc(db, 'ditte/dittaA/foto/f2'), { commessaId: 'c1' }))
    await assertFails(deleteDoc(doc(db, 'ditte/dittaA/foto/f1')))
  })
})

describe('operatore attivo', () => {
  it('legge la ditta e le commesse attive', async () => {
    const db = operatore('mario')
    await assertSucceeds(getDoc(doc(db, 'ditte/dittaA')))
    await assertSucceeds(getDocs(query(collection(db, 'ditte/dittaA/commesse'), where('attiva', '==', true))))
    await assertSucceeds(getDoc(doc(db, 'ditte/dittaA/commesse/c1')))
  })

  it('non vede le commesse chiuse', async () => {
    const db = operatore('mario')
    await assertFails(getDoc(doc(db, 'ditte/dittaA/commesse/c2')))
    await assertFails(getDocs(collection(db, 'ditte/dittaA/commesse')))
  })

  it('legge la propria scheda ma non quelle dei colleghi', async () => {
    const db = operatore('mario')
    await assertSucceeds(getDoc(doc(db, 'ditte/dittaA/operatori/mario')))
    await assertFails(getDoc(doc(db, 'ditte/dittaA/operatori/luigi')))
    await assertFails(getDocs(collection(db, 'ditte/dittaA/operatori')))
  })

  it('non modifica ditta, commesse, operatori né indice foto', async () => {
    const db = operatore('mario')
    await assertFails(updateDoc(doc(db, 'ditte/dittaA'), { nome: 'X', aggiornataIl: serverTimestamp() }))
    await assertFails(setDoc(doc(db, 'ditte/dittaA/commesse/nuova'), commessaNuova()))
    await assertFails(updateDoc(doc(db, 'ditte/dittaA/operatori/mario'), { attivo: true, aggiornatoIl: serverTimestamp() }))
    await assertFails(setDoc(doc(db, 'ditte/dittaA/foto/f2'), { commessaId: 'c1' }))
  })

  it("legge l'indice foto", async () => {
    await assertSucceeds(getDocs(collection(operatore('mario'), 'ditte/dittaA/foto')))
  })
})

describe('operatore disattivato', () => {
  it('è bloccato su tutto', async () => {
    const db = operatore('luigi')
    await assertFails(getDoc(doc(db, 'ditte/dittaA')))
    await assertFails(getDocs(query(collection(db, 'ditte/dittaA/commesse'), where('attiva', '==', true))))
    await assertFails(getDocs(collection(db, 'ditte/dittaA/foto')))
    await assertFails(getDoc(doc(db, 'ditte/dittaA/operatori/luigi')))
  })

  it('viene bloccato subito quando viene disattivato, col token ancora valido', async () => {
    const db = operatore('mario')
    await assertSucceeds(getDocs(collection(db, 'ditte/dittaA/foto')))
    await amb.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'ditte/dittaA/operatori/mario'), { attivo: false }))
    await assertFails(getDocs(collection(db, 'ditte/dittaA/foto')))
  })

  it('un operatore inesistente è bloccato', async () => {
    await assertFails(getDoc(doc(operatore('fantasma'), 'ditte/dittaA')))
  })
})

describe('raccolte riservate alle Functions', () => {
  const riservati = ['titolari/titolareA', 'collegamentiInCorso/x', 'collegamentiDaConfermare/x', 'caricamenti/x', 'cacheCartelle/x', 'sessioniSimulate/x', 'codiciDitta/CODA23', 'codiciOperatore/impronta', 'credenzialiArchivio/dittaA', 'tentativiAccesso/x']

  it('nessuno le legge, nemmeno il titolare', async () => {
    for (const percorso of riservati) {
      await assertFails(getDoc(doc(titolareA(), percorso)))
      await assertFails(getDoc(doc(operatore('mario'), percorso)))
      await assertFails(getDoc(doc(anonimo(), percorso)))
    }
  })

  it('nessuno le scrive', async () => {
    for (const percorso of riservati) {
      await assertFails(setDoc(doc(titolareA(), percorso), { dittaId: 'dittaA' }))
    }
  })
})
