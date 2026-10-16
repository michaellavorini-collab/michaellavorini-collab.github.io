import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  admin, chiamaDalBrowser, chiudiClient, entraComeOperatore, erroreDi, svuotaEmulatori, titolareConDitta,
  type Client,
} from './aiuti'

const CARTELLA_SIMULATA = join(import.meta.dirname, '..', '.archivio-simulato')

beforeEach(svuotaEmulatori)
afterEach(chiudiClient)

type Aperto = { idCaricamento: string; urlCaricamento: string }

/** Ditta con archivio di prova, una commessa attiva, una chiusa e un operatore entrato. */
async function prepara({ collegaArchivio = true } = {}) {
  const t = await titolareConDitta('titolare@ditta.it', 'Termoidraulica Rossi')
  if (collegaArchivio) await t.client.chiama('collegaArchivioSimulato')
  const dittaRif = admin.db.doc(`ditte/${t.dittaId}`)
  await dittaRif.collection('commesse').doc('c1').set({
    numero: '2026-014', descrizione: 'Sostituzione caldaia', cliente: 'Bianchi', attiva: true,
    creataIl: new Date(), aggiornataIl: new Date(),
  })
  await dittaRif.collection('commesse').doc('chiusa').set({
    numero: '2025-001', descrizione: 'Vecchia', cliente: '', attiva: false, creataIl: new Date(), aggiornataIl: new Date(),
  })
  const { operatoreId, codice } = await t.client.chiama<{ operatoreId: string; codice: string }>('creaOperatore', { nome: 'Mario' })
  const op = await entraComeOperatore(t.codiceDitta, codice)
  return { ...t, op, operatoreId }
}

const foto = (n = 5000) => Buffer.from(Array.from({ length: n }, (_, i) => i % 251))
const richiesta = (dati: object = {}) => ({
  commessaId: 'c1', sottocartella: 'Prima', dimensione: 5000, larghezza: 1600, altezza: 1200,
  scattataIl: Date.UTC(2026, 9, 16, 12, 30, 5), ...dati,
})

async function caricaFoto(c: Client, byte = foto(), dati: object = {}) {
  const aperto = await chiamaDalBrowser<Aperto>(c, 'apriCaricamento', richiesta({ dimensione: byte.length, ...dati }))
  const put = await fetch(aperto.urlCaricamento, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: byte })
  expect(put.status).toBe(200)
  const { id } = (await put.json()) as { id: string }
  return { ...aperto, fileId: id }
}

describe('caricamento di una foto', () => {
  it("l'operatore carica: file nell'archivio e voce nell'indice", async () => {
    const { op, dittaId, operatoreId } = await prepara()
    const byte = foto(5000)
    const { idCaricamento, fileId } = await caricaFoto(op, byte)
    const r = await chiamaDalBrowser<{ fotoId: string }>(op, 'registraFoto', { idCaricamento, fileId })
    expect(r.fotoId).toBe(idCaricamento)

    const voce = (await admin.db.doc(`ditte/${dittaId}/foto/${idCaricamento}`).get()).data()!
    expect(voce).toMatchObject({
      commessaId: 'c1', sottocartella: 'Prima', archivio: 'simulato', fileId, mimeType: 'image/jpeg',
      dimensione: 5000, larghezza: 1600, altezza: 1200, operatoreId, autore: 'Mario',
      caricataDaUid: op.auth.currentUser!.uid,
    })
    // Nome con commessa, sottocartella e ora italiana dello scatto.
    expect(voce.nomeFile).toMatch(/^2026-014_Prima_20261016-143005_[0-9a-f]{6}\.jpg$/)
    expect(voce.scattataIl.toMillis()).toBe(Date.UTC(2026, 9, 16, 12, 30, 5))

    // Struttura: Foto Cantieri / <commessa> / <sottocartella> / file.
    const percorso = join(CARTELLA_SIMULATA, dittaId, 'Foto Cantieri', '2026-014 - Sostituzione caldaia', 'Prima', voce.nomeFile)
    expect(readFileSync(percorso).equals(byte)).toBe(true)

    // Nel database nessun byte della foto: solo l'indice. E il caricamento aperto è chiuso.
    expect((await admin.db.doc(`caricamenti/${idCaricamento}`).get()).exists).toBe(false)
  })

  it('registrare due volte non crea doppioni', async () => {
    const { op, dittaId } = await prepara()
    const { idCaricamento, fileId } = await caricaFoto(op)
    await chiamaDalBrowser(op, 'registraFoto', { idCaricamento, fileId })
    await chiamaDalBrowser(op, 'registraFoto', { idCaricamento, fileId })
    expect((await admin.db.collection(`ditte/${dittaId}/foto`).get()).size).toBe(1)
  })

  it('le foto di sottocartelle diverse vanno in cartelle diverse della stessa commessa', async () => {
    const { op, dittaId } = await prepara()
    for (const sottocartella of ['Prima', 'Dopo', 'Prima']) {
      const { idCaricamento, fileId } = await caricaFoto(op, foto(), { sottocartella })
      await chiamaDalBrowser(op, 'registraFoto', { idCaricamento, fileId })
    }
    const base = join(CARTELLA_SIMULATA, dittaId, 'Foto Cantieri', '2026-014 - Sostituzione caldaia')
    expect(existsSync(join(base, 'Prima'))).toBe(true)
    expect(existsSync(join(base, 'Dopo'))).toBe(true)
    expect((await admin.db.collection(`ditte/${dittaId}/foto`).get()).size).toBe(3)
  })

  it('anche il titolare può caricare', async () => {
    const { client, dittaId } = await prepara()
    const { idCaricamento, fileId } = await caricaFoto(client)
    await chiamaDalBrowser(client, 'registraFoto', { idCaricamento, fileId })
    const voce = (await admin.db.doc(`ditte/${dittaId}/foto/${idCaricamento}`).get()).data()!
    expect(voce.operatoreId).toBeUndefined()
  })
})

describe('controlli in apertura', () => {
  it('rifiuta commessa chiusa, inesistente, sottocartella sconosciuta e dati non validi', async () => {
    const { op } = await prepara()
    const prova = async (dati: object) => (await erroreDi(chiamaDalBrowser(op, 'apriCaricamento', richiesta(dati)))).code
    expect(await prova({ commessaId: 'chiusa' })).toBe('functions/failed-precondition')
    expect(await prova({ commessaId: 'nessuna' })).toBe('functions/not-found')
    expect(await prova({ commessaId: '../x' })).toBe('functions/invalid-argument')
    expect(await prova({ sottocartella: 'Inventata' })).toBe('functions/invalid-argument')
    expect(await prova({ dimensione: 16 * 1024 * 1024 })).toBe('functions/invalid-argument')
    expect(await prova({ dimensione: 0 })).toBe('functions/invalid-argument')
  })

  it("rifiuta se l'app è aperta da un indirizzo non autorizzato", async () => {
    const { op } = await prepara()
    const e = await erroreDi(chiamaDalBrowser(op, 'apriCaricamento', richiesta(), 'https://sito-estraneo.it'))
    expect(e.code).toBe('functions/permission-denied')
  })

  it("rifiuta se l'archivio non è collegato", async () => {
    const { op } = await prepara({ collegaArchivio: false })
    const e = await erroreDi(chiamaDalBrowser(op, 'apriCaricamento', richiesta()))
    expect(e.code).toBe('functions/failed-precondition')
    expect(e.message).toMatch(/collegare Google Drive/)
  })

  it("rifiuta chi non ha fatto login e l'operatore disattivato", async () => {
    const { client, op, operatoreId } = await prepara()
    expect((await erroreDi(chiamaDalBrowser(null, 'apriCaricamento', richiesta()))).code).toBe('functions/unauthenticated')
    await client.chiama('impostaOperatoreAttivo', { operatoreId, attivo: false })
    const e = await erroreDi(chiamaDalBrowser(op, 'apriCaricamento', richiesta()))
    expect(e.code).toBe('functions/permission-denied')
    expect(e.message).toMatch(/disattivato/)
  })
})

describe('controlli in registrazione', () => {
  it('rifiuta se i byte arrivati non sono quelli dichiarati', async () => {
    const { op } = await prepara()
    const aperto = await chiamaDalBrowser<Aperto>(op, 'apriCaricamento', richiesta({ dimensione: 5000 }))
    const put = await fetch(aperto.urlCaricamento, { method: 'PUT', body: foto(10) })
    expect(put.status).toBe(400)
  })

  it('rifiuta un file diverso da quello del caricamento', async () => {
    const { op } = await prepara()
    const prima = await caricaFoto(op, foto(), { sottocartella: 'Prima' })
    const seconda = await caricaFoto(op, foto(), { sottocartella: 'Dopo' })
    const e = await erroreDi(chiamaDalBrowser(op, 'registraFoto', { idCaricamento: prima.idCaricamento, fileId: seconda.fileId }))
    expect(e.code).toBe('functions/failed-precondition')
  })

  it('rifiuta un file mai caricato', async () => {
    const { op } = await prepara()
    const aperto = await chiamaDalBrowser<Aperto>(op, 'apriCaricamento', richiesta())
    const e = await erroreDi(chiamaDalBrowser(op, 'registraFoto', { idCaricamento: aperto.idCaricamento, fileId: 'aW5lc2lzdGVudGU' }))
    expect(e.code).toBe('functions/failed-precondition')
  })

  it("non si registra il caricamento di un altro utente o di un'altra ditta", async () => {
    const { client, op } = await prepara()
    const { idCaricamento, fileId } = await caricaFoto(op)
    expect((await erroreDi(chiamaDalBrowser(client, 'registraFoto', { idCaricamento, fileId }))).code).toBe('functions/not-found')
    const altra = await titolareConDitta('altro@ditta.it', 'Altra')
    expect((await erroreDi(chiamaDalBrowser(altra.client, 'registraFoto', { idCaricamento, fileId }))).code).toBe('functions/not-found')
  })

  it("l'indirizzo di caricamento vale una volta sola", async () => {
    const { op } = await prepara()
    const { urlCaricamento } = await caricaFoto(op)
    expect((await fetch(urlCaricamento, { method: 'PUT', body: foto() })).status).toBe(404)
  })
})
