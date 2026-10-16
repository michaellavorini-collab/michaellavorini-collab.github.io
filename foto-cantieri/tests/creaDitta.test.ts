import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  admin, chiudiClient, clientAnonimo, clientEmail, clientGoogle, erroreDi, svuotaEmulatori,
} from './aiuti'

type Risposta = { dittaId: string; codiceDitta: string; nuova: boolean }

beforeEach(svuotaEmulatori)
afterEach(chiudiClient)

describe('creaDitta', () => {
  it('crea la ditta, il codice e i permessi del titolare', async () => {
    const c = await clientGoogle('mario@termoidraulica.it')
    const r = await c.chiama<Risposta>('creaDitta', { nome: '  Termoidraulica   Rossi ' })

    expect(r.nuova).toBe(true)
    expect(r.codiceDitta).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)

    const ditta = (await admin.db.doc(`ditte/${r.dittaId}`).get()).data()!
    expect(ditta.nome).toBe('Termoidraulica Rossi')
    expect(ditta.codiceDitta).toBe(r.codiceDitta)
    expect(ditta.titolareUid).toBe(c.auth.currentUser!.uid)
    expect(ditta.titolareEmail).toBe('mario@termoidraulica.it')
    expect(ditta.archivio).toEqual({ tipo: 'nessuno', stato: 'scollegato' })

    const codice = (await admin.db.doc(`codiciDitta/${r.codiceDitta}`).get()).data()
    expect(codice).toEqual({ dittaId: r.dittaId })

    // Dopo il rinnovo del token il titolare ha dittaId e ruolo.
    const token = await c.auth.currentUser!.getIdTokenResult(true)
    expect(token.claims.dittaId).toBe(r.dittaId)
    expect(token.claims.ruolo).toBe('titolare')
  })

  it('chiamata due volte non crea una seconda ditta', async () => {
    const c = await clientGoogle('anna@elettrica.it')
    const prima = await c.chiama<Risposta>('creaDitta', { nome: 'Elettrica Bianchi' })
    const seconda = await c.chiama<Risposta>('creaDitta', { nome: 'Altro nome' })
    expect(seconda).toEqual({ ...prima, nuova: false })
    expect((await admin.db.collection('ditte').get()).size).toBe(1)
  })

  it('due titolari ottengono ditte e codici diversi', async () => {
    const a = await (await clientGoogle('a@x.it')).chiama<Risposta>('creaDitta', { nome: 'A' })
    const b = await (await clientGoogle('b@x.it')).chiama<Risposta>('creaDitta', { nome: 'B' })
    expect(a.dittaId).not.toBe(b.dittaId)
    expect(a.codiceDitta).not.toBe(b.codiceDitta)
  })

  it('rifiuta chi non ha fatto login', async () => {
    const e = await erroreDi(clientAnonimo().chiama('creaDitta', { nome: 'X' }))
    expect(e.code).toBe('functions/unauthenticated')
  })

  it('rifiuta chi non è entrato con Google', async () => {
    const c = await clientEmail('finto@x.it')
    const e = await erroreDi(c.chiama('creaDitta', { nome: 'X' }))
    expect(e.code).toBe('functions/permission-denied')
  })

  it('rifiuta un nome vuoto o troppo lungo', async () => {
    const c = await clientGoogle('c@x.it')
    expect((await erroreDi(c.chiama('creaDitta', { nome: '   ' }))).code).toBe('functions/invalid-argument')
    expect((await erroreDi(c.chiama('creaDitta', { nome: 'x'.repeat(81) }))).code).toBe('functions/invalid-argument')
    expect((await erroreDi(c.chiama('creaDitta', {}))).code).toBe('functions/invalid-argument')
    expect((await admin.db.collection('ditte').get()).size).toBe(0)
  })
})
