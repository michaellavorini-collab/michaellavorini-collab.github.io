/** Preparazione comune alle prove di caricamento e galleria (archivio di prova). */
import { expect } from 'vitest'
import { admin, chiamaDalBrowser, entraComeOperatore, titolareConDitta, type Client } from './aiuti'

export type Aperto = { idCaricamento: string; urlCaricamento: string }

/** Ditta con archivio di prova, una commessa attiva, una chiusa e un operatore entrato. */
export async function prepara({ collegaArchivio = true } = {}) {
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

export const foto = (n = 5000) => Buffer.from(Array.from({ length: n }, (_, i) => i % 251))
export const richiesta = (dati: object = {}) => ({
  commessaId: 'c1', sottocartella: 'Prima', dimensione: 5000, larghezza: 1600, altezza: 1200,
  scattataIl: Date.UTC(2026, 9, 16, 12, 30, 5), ...dati,
})

export async function caricaFoto(c: Client, byte = foto(), dati: object = {}) {
  const aperto = await chiamaDalBrowser<Aperto>(c, 'apriCaricamento', richiesta({ dimensione: byte.length, ...dati }))
  const put = await fetch(aperto.urlCaricamento, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: byte })
  expect(put.status).toBe(200)
  const { id } = (await put.json()) as { id: string }
  return { ...aperto, fileId: id }
}

/** Carica e registra una foto; restituisce l'id della voce nell'indice. */
export async function fotoCompleta(c: Client, byte = foto(), dati: object = {}) {
  const { idCaricamento, fileId } = await caricaFoto(c, byte, dati)
  await chiamaDalBrowser(c, 'registraFoto', { idCaricamento, fileId })
  return idCaricamento
}
