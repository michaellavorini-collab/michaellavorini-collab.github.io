import { doc, getDoc } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  admin, chiudiClient, clientAnonimo, entraComeOperatore, erroreDi, svuotaEmulatori, titolareConDitta,
  type Client,
} from './aiuti'

beforeEach(svuotaEmulatori)
afterEach(chiudiClient)

type Creato = { operatoreId: string; codice: string }

async function preparaDitta() {
  const t = await titolareConDitta('titolare@ditta.it', 'Termoidraulica Rossi')
  const mario = await t.client.chiama<Creato>('creaOperatore', { nome: 'Mario' })
  return { ...t, mario }
}

const imposta = (c: Client, operatoreId: string, attivo: boolean) =>
  c.chiama('impostaOperatoreAttivo', { operatoreId, attivo })

const accesso = (c: Client, codiceDitta: string, codicePersonale: string) =>
  c.chiama<{ token: string }>('accessoOperatore', { codiceDitta, codicePersonale })

describe('creaOperatore', () => {
  it('crea un operatore attivo con un codice di 5 cifre, salvato solo come impronta', async () => {
    const { dittaId, mario } = await preparaDitta()
    expect(mario.codice).toMatch(/^\d{5}$/)

    const operatore = (await admin.db.doc(`ditte/${dittaId}/operatori/${mario.operatoreId}`).get()).data()!
    expect(operatore.nome).toBe('Mario')
    expect(operatore.attivo).toBe(true)

    const codici = await admin.db.collection('codiciOperatore').get()
    expect(codici.size).toBe(1)
    expect(codici.docs[0].id).toMatch(/^[0-9a-f]{64}$/)
    expect(codici.docs[0].data()).toEqual({ dittaId, operatoreId: mario.operatoreId })

    // Il codice non compare da nessuna parte nel database.
    for (const raccolta of ['codiciOperatore', `ditte/${dittaId}/operatori`]) {
      const tutto = JSON.stringify((await admin.db.collection(raccolta).get()).docs.map((d) => [d.id, d.data()]))
      expect(tutto).not.toContain(mario.codice)
    }
  })

  it('codici diversi per operatori diversi', async () => {
    const { client } = await preparaDitta()
    const codici = new Set<string>()
    for (let i = 0; i < 5; i++) codici.add((await client.chiama<Creato>('creaOperatore', { nome: `Op ${i}` })).codice)
    expect(codici.size).toBe(5)
  })

  it('solo il titolare crea operatori', async () => {
    const { codiceDitta, mario } = await preparaDitta()
    expect((await erroreDi(clientAnonimo().chiama('creaOperatore', { nome: 'X' }))).code).toBe('functions/unauthenticated')
    const op = await entraComeOperatore(codiceDitta, mario.codice)
    expect((await erroreDi(op.chiama('creaOperatore', { nome: 'X' }))).code).toBe('functions/permission-denied')
  })
})

describe('accessoOperatore', () => {
  it('con i codici giusti restituisce un token con ditta, ruolo e operatore', async () => {
    const { dittaId, codiceDitta, mario } = await preparaDitta()
    const op = await entraComeOperatore(codiceDitta, mario.codice)
    const { claims } = await op.auth.currentUser!.getIdTokenResult()
    expect(claims.dittaId).toBe(dittaId)
    expect(claims.ruolo).toBe('operatore')
    expect(claims.operatoreId).toBe(mario.operatoreId)
    expect(op.auth.currentUser!.uid).toBe(`op_${dittaId}_${mario.operatoreId}`)
    // E con quel token legge i dati della sua ditta.
    expect((await getDoc(doc(op.db, `ditte/${dittaId}`))).get('nome')).toBe('Termoidraulica Rossi')
  })

  it('accetta il codice ditta in minuscolo e con spazi', async () => {
    const { codiceDitta, mario } = await preparaDitta()
    const scritto = ` ${codiceDitta.slice(0, 3).toLowerCase()} ${codiceDitta.slice(3).toLowerCase()} `
    await entraComeOperatore(scritto, mario.codice)
  })

  it('codice personale sbagliato o ditta sbagliata: stesso messaggio generico', async () => {
    const { codiceDitta, mario } = await preparaDitta()
    const sbagliato = String((Number(mario.codice) + 1) % 100000).padStart(5, '0')
    const e1 = await erroreDi(accesso(clientAnonimo(), codiceDitta, sbagliato))
    const e2 = await erroreDi(accesso(clientAnonimo(), 'ZZZZZZ', mario.codice))
    const e3 = await erroreDi(accesso(clientAnonimo(), 'corto', 'abc'))
    for (const e of [e1, e2, e3]) {
      expect(e.code).toBe('functions/permission-denied')
      expect(e.message).toBe('Codice ditta o codice personale non corretti.')
    }
  })

  it('campi mancanti', async () => {
    const e = await erroreDi(clientAnonimo().chiama('accessoOperatore', {}))
    expect(e.code).toBe('functions/invalid-argument')
  })

  it("il codice di un operatore della ditta A non vale con il codice della ditta B", async () => {
    const a = await preparaDitta()
    const b = await titolareConDitta('altro@ditta.it', 'Ditta B')
    const e = await erroreDi(accesso(clientAnonimo(), b.codiceDitta, a.mario.codice))
    expect(e.code).toBe('functions/permission-denied')
  })

  it('dopo 5 errori blocca per 15 minuti, anche con il codice giusto', async () => {
    const { codiceDitta, mario } = await preparaDitta()
    const sbagliato = mario.codice === '00000' ? '11111' : '00000'
    for (let i = 0; i < 5; i++) {
      expect((await erroreDi(accesso(clientAnonimo(), codiceDitta, sbagliato))).code).toBe('functions/permission-denied')
    }
    const e = await erroreDi(accesso(clientAnonimo(), codiceDitta, mario.codice))
    expect(e.code).toBe('functions/resource-exhausted')
    expect(e.message).toMatch(/Riprova tra 15 minuti/)
    // Nei contatori non c'è l'indirizzo IP in chiaro.
    const chiavi = (await admin.db.collection('tentativiAccesso').get()).docs.map((d) => d.id).join(' ')
    expect(chiavi).not.toContain('127.0.0.1')
  })

  it("un accesso riuscito azzera gli errori del dispositivo", async () => {
    const { codiceDitta, mario } = await preparaDitta()
    const sbagliato = mario.codice === '00000' ? '11111' : '00000'
    for (let i = 0; i < 4; i++) await erroreDi(accesso(clientAnonimo(), codiceDitta, sbagliato))
    await accesso(clientAnonimo(), codiceDitta, mario.codice)
    for (let i = 0; i < 4; i++) await erroreDi(accesso(clientAnonimo(), codiceDitta, sbagliato))
    await accesso(clientAnonimo(), codiceDitta, mario.codice)
  })
})

describe('disattivazione', () => {
  it("l'operatore disattivato non può più entrare", async () => {
    const { client, codiceDitta, mario } = await preparaDitta()
    await imposta(client, mario.operatoreId, false)
    const e = await erroreDi(accesso(clientAnonimo(), codiceDitta, mario.codice))
    expect(e.code).toBe('functions/permission-denied')
    expect(e.message).toMatch(/disattivato/)
  })

  it("l'operatore già dentro viene bloccato subito e le sue sessioni revocate", async () => {
    const { client, dittaId, codiceDitta, mario } = await preparaDitta()
    const op = await entraComeOperatore(codiceDitta, mario.codice)
    const rifDitta = doc(op.db, `ditte/${dittaId}`)
    await getDoc(rifDitta)

    const idToken = await op.auth.currentUser!.getIdToken()
    await admin.auth.verifyIdToken(idToken, true)
    // La revoca vale per i token emessi prima del secondo in cui avviene.
    await new Promise((r) => setTimeout(r, 1100))
    await imposta(client, mario.operatoreId, false)

    // Subito: le regole lo bloccano anche se il suo token è ancora valido.
    expect((await erroreDi(getDoc(rifDitta))).code).toBe('permission-denied')

    // E le sue sessioni sono revocate: il token non si può più rinnovare.
    await expect(admin.auth.verifyIdToken(idToken, true)).rejects.toMatchObject({ code: 'auth/id-token-revoked' })
  })

  it('riattivato, può rientrare', async () => {
    const { client, dittaId, codiceDitta, mario } = await preparaDitta()
    await imposta(client, mario.operatoreId, false)
    expect((await admin.db.doc(`ditte/${dittaId}/operatori/${mario.operatoreId}`).get()).get('attivo')).toBe(false)
    await imposta(client, mario.operatoreId, true)
    await entraComeOperatore(codiceDitta, mario.codice)
  })
})

describe('impostaOperatoreAttivo', () => {
  it("solo il titolare della stessa ditta", async () => {
    const a = await preparaDitta()
    const b = await titolareConDitta('altro@ditta.it', 'Ditta B')
    expect((await erroreDi(imposta(b.client, a.mario.operatoreId, false))).code).toBe('functions/not-found')
    const op = await entraComeOperatore(a.codiceDitta, a.mario.codice)
    expect((await erroreDi(imposta(op, a.mario.operatoreId, false))).code).toBe('functions/permission-denied')
    expect((await erroreDi(a.client.chiama('impostaOperatoreAttivo', { operatoreId: a.mario.operatoreId, attivo: 'no' }))).code)
      .toBe('functions/invalid-argument')
    expect((await erroreDi(a.client.chiama('impostaOperatoreAttivo', { operatoreId: '../x', attivo: false }))).code)
      .toBe('functions/invalid-argument')
  })
})

describe('nuovoCodiceOperatore', () => {
  it('il vecchio codice smette di funzionare, il nuovo funziona', async () => {
    const { client, codiceDitta, mario } = await preparaDitta()
    const { codice } = await client.chiama<{ codice: string }>('nuovoCodiceOperatore', { operatoreId: mario.operatoreId })
    expect(codice).toMatch(/^\d{5}$/)
    expect((await admin.db.collection('codiciOperatore').get()).size).toBe(1)
    if (codice !== mario.codice) {
      expect((await erroreDi(accesso(clientAnonimo(), codiceDitta, mario.codice))).code).toBe('functions/permission-denied')
    }
    await entraComeOperatore(codiceDitta, codice)
  })

  it("non funziona sugli operatori di un'altra ditta", async () => {
    const a = await preparaDitta()
    const b = await titolareConDitta('altro@ditta.it', 'Ditta B')
    const e = await erroreDi(b.client.chiama('nuovoCodiceOperatore', { operatoreId: a.mario.operatoreId }))
    expect(e.code).toBe('functions/not-found')
  })
})
