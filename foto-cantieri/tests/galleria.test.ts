import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Timestamp } from 'firebase-admin/firestore'
import { collection, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { admin, chiudiClient, ORIGINE_APP, svuotaEmulatori, titolareConDitta, type Client } from './aiuti'
import { foto, fotoCompleta, prepara } from './aiuti-foto'

const URL_MINIATURA = 'http://127.0.0.1:5001/demo-foto-cantieri/europe-west1/miniatura'
const CARTELLA_SIMULATA = join(import.meta.dirname, '..', '.archivio-simulato')

beforeEach(svuotaEmulatori)
afterEach(chiudiClient)

async function chiediMiniatura(c: Client | null, fotoId: string, extra: { misura?: string; origine?: string; token?: string } = {}) {
  const headers: Record<string, string> = {}
  const token = extra.token ?? (c ? await c.auth.currentUser!.getIdToken() : undefined)
  if (token) headers.Authorization = `Bearer ${token}`
  if (extra.origine) headers.Origin = extra.origine
  const q = new URLSearchParams({ foto: fotoId, ...(extra.misura ? { misura: extra.misura } : {}) })
  return fetch(`${URL_MINIATURA}?${q}`, { headers })
}

/** Tutti i file dell'archivio di prova (percorso e dimensione). */
function fileArchivio(): string[] {
  const elenco: string[] = []
  const visita = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) visita(p)
      else elenco.push(`${p}:${statSync(p).size}`)
    }
  }
  visita(CARTELLA_SIMULATA)
  return elenco.sort()
}

/** Numero di documenti in ogni raccolta del database (anche le sottoraccolte delle ditte). */
async function contaDocumenti(): Promise<Record<string, number>> {
  const conti: Record<string, number> = {}
  for (const r of await admin.db.listCollections()) {
    const docs = await r.listDocuments()
    conti[r.id] = docs.length
    for (const d of docs) for (const s of await d.listCollections()) conti[`${r.id}/*/${s.id}`] = (conti[`${r.id}/*/${s.id}`] ?? 0) + (await s.get()).size
  }
  return conti
}

describe('miniatura', () => {
  it('passa la foto letta dall\'archivio, solo nel browser di chi la chiede', async () => {
    const { op } = await prepara()
    const byte = foto(7000)
    const fotoId = await fotoCompleta(op, byte)
    const r = await chiediMiniatura(op, fotoId)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/jpeg')
    expect(r.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(Buffer.from(await r.arrayBuffer()).equals(byte)).toBe(true)
    expect((await chiediMiniatura(op, fotoId, { misura: 'grande' })).status).toBe(200)
  })

  it('non salva nulla: né file né documenti in più', async () => {
    const { op, client } = await prepara()
    const fotoId = await fotoCompleta(op)
    const filePrima = fileArchivio()
    const docPrima = await contaDocumenti()
    for (let i = 0; i < 3; i++) expect((await chiediMiniatura(i % 2 ? client : op, fotoId)).status).toBe(200)
    expect(fileArchivio()).toEqual(filePrima)
    expect(await contaDocumenti()).toEqual(docPrima)
  })

  it('senza accesso, con token falso o con foto non valida: rifiuta', async () => {
    const { op } = await prepara()
    const fotoId = await fotoCompleta(op)
    expect((await chiediMiniatura(null, fotoId)).status).toBe(401)
    expect((await chiediMiniatura(null, fotoId, { token: 'inventato' })).status).toBe(401)
    expect((await chiediMiniatura(op, '../x')).status).toBe(400)
    expect((await chiediMiniatura(op, 'inesistente')).status).toBe(404)
  })

  it("il titolare di un'altra ditta non vede la foto", async () => {
    const { op } = await prepara()
    const fotoId = await fotoCompleta(op)
    const altra = await titolareConDitta('altro@ditta.it', 'Altra ditta')
    await altra.client.chiama('collegaArchivioSimulato')
    expect((await chiediMiniatura(altra.client, fotoId)).status).toBe(404)
  })

  it("l'operatore disattivato è bloccato subito (sessione revocata)", async () => {
    const { client, op, operatoreId } = await prepara()
    const fotoId = await fotoCompleta(op)
    await new Promise((r) => setTimeout(r, 1100)) // la revoca vale per i token di prima
    await client.chiama('impostaOperatoreAttivo', { operatoreId, attivo: false })
    expect((await chiediMiniatura(op, fotoId)).status).toBe(401)
  })

  it("anche senza revoca, conta che l'operatore sia attivo", async () => {
    const { dittaId, op, operatoreId } = await prepara()
    const fotoId = await fotoCompleta(op)
    await admin.db.doc(`ditte/${dittaId}/operatori/${operatoreId}`).update({ attivo: false })
    const r = await chiediMiniatura(op, fotoId)
    expect(r.status).toBe(403)
    expect(await r.text()).toMatch(/disattivato/)
  })

  it('dopo un nuovo codice, la vecchia sessione non vede più le foto', async () => {
    const { client, op, operatoreId } = await prepara()
    const fotoId = await fotoCompleta(op)
    await new Promise((r) => setTimeout(r, 1100))
    await client.chiama('nuovoCodiceOperatore', { operatoreId })
    expect((await chiediMiniatura(op, fotoId)).status).toBe(401)
  })

  it('CORS solo per gli indirizzi dell\'app', async () => {
    const { op } = await prepara()
    const fotoId = await fotoCompleta(op)
    const pre = await fetch(`${URL_MINIATURA}?foto=${fotoId}`, {
      method: 'OPTIONS', headers: { Origin: ORIGINE_APP, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGINE_APP)
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Authorization/i)

    const ok = await chiediMiniatura(op, fotoId, { origine: ORIGINE_APP })
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGINE_APP)
    // Da un sito estraneo la foto non viene consegnata.
    // (L'emulatore aggiunge da sé gli header CORS a ogni risposta: si controlla stato e contenuto.)
    const estraneo = await chiediMiniatura(op, fotoId, { origine: 'https://sito-estraneo.it' })
    expect(estraneo.status).toBe(403)
    expect(estraneo.headers.get('content-type')).not.toBe('image/jpeg')
    expect(await estraneo.text()).toBe('Indirizzo non autorizzato')
  })
})

describe('elenco della galleria', () => {
  it('12 alla volta, dalle più recenti, solo della commessa scelta', async () => {
    const { op, dittaId } = await prepara()
    const base = Date.UTC(2026, 9, 1)
    const batch = admin.db.batch()
    for (let i = 0; i < 14; i++) {
      batch.set(admin.db.doc(`ditte/${dittaId}/foto/f${String(i).padStart(2, '0')}`), {
        commessaId: 'c1', sottocartella: 'Prima', archivio: 'simulato', fileId: `file${i}`, cartellaId: 'x',
        nomeFile: `f${i}.jpg`, mimeType: 'image/jpeg', dimensione: 1, larghezza: 1600, altezza: 1200,
        caricataDaUid: 'u', autore: 'Mario', scattataIl: Timestamp.fromMillis(base), caricataIl: Timestamp.fromMillis(base + i * 60_000),
      })
    }
    batch.set(admin.db.doc(`ditte/${dittaId}/foto/altra`), {
      commessaId: 'altra', caricataIl: Timestamp.fromMillis(base + 99 * 60_000),
    })
    await batch.commit()

    const q = query(collection(op.db, `ditte/${dittaId}/foto`), where('commessaId', '==', 'c1'), orderBy('caricataIl', 'desc'), limit(12))
    const prima = await getDocs(q)
    expect(prima.docs.map((d) => d.id)).toEqual(['f13', 'f12', 'f11', 'f10', 'f09', 'f08', 'f07', 'f06', 'f05', 'f04', 'f03', 'f02'])
    const seconda = await getDocs(query(q, startAfter(prima.docs[prima.docs.length - 1])))
    expect(seconda.docs.map((d) => d.id)).toEqual(['f01', 'f00'])
  })
})
