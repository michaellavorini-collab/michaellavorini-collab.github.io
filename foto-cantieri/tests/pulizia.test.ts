import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it } from 'vitest'
import { eseguiPulizia } from '../functions/src/manutenzione/pulizia'
import { PROGETTO, svuotaEmulatori } from './aiuti'

// La pulizia gira con il firebase-admin delle Functions: si usa la stessa copia
// (Firestore non accetta Timestamp creati da un'altra copia del pacchetto).
const richiedi = createRequire(new URL('../functions/package.json', import.meta.url))
const adminApp = richiedi('firebase-admin/app') as typeof import('firebase-admin/app')
const adminFs = richiedi('firebase-admin/firestore') as typeof import('firebase-admin/firestore')
const app = adminApp.getApps().find((a) => a.name === 'pulizia') ?? adminApp.initializeApp({ projectId: PROGETTO }, 'pulizia')
const d = adminFs.getFirestore(app)
const { Timestamp } = adminFs

beforeEach(svuotaEmulatori)

const ORA = Date.UTC(2026, 9, 17, 1, 17)
const fra = (minuti: number) => Timestamp.fromMillis(ORA + minuti * 60_000)

describe('pulizia notturna', () => {
  it('cancella solo i documenti temporanei scaduti', async () => {
    await Promise.all([
      d.doc('caricamenti/scaduto').set({ dittaId: 'A', scadeIl: fra(-1) }),
      d.doc('caricamenti/valido').set({ dittaId: 'A', scadeIl: fra(60) }),
      d.doc('collegamentiInCorso/scaduto').set({ dittaId: 'A', scadeIl: fra(-5) }),
      d.doc('collegamentiInCorso/valido').set({ dittaId: 'A', scadeIl: fra(5) }),
      d.doc('sessioniSimulate/scaduta').set({ dittaId: 'A', scadeIl: fra(-1) }),
      d.doc('collegamentiDaConfermare/scaduto').set({ dittaId: 'A', scadeIl: fra(-1) }),
      d.doc('collegamentiDaConfermare/valido').set({ dittaId: 'A', scadeIl: fra(5) }),
      d.doc('tentativiAccesso/vecchio').set({ falliti: 3, ultimoIl: fra(-25 * 60) }),
      d.doc('tentativiAccesso/recente').set({ falliti: 3, ultimoIl: fra(-60) }),
      // Dati della ditta e indice foto: mai toccati, anche con campi "vecchi".
      d.doc('ditte/A').set({ nome: 'Ditta', scadeIl: fra(-999) }),
      d.doc('ditte/A/foto/f1').set({ commessaId: 'c1', caricataIl: fra(-99999) }),
    ])

    const esito = await eseguiPulizia(d, ORA)
    expect(esito).toEqual({ caricamenti: 1, collegamentiInCorso: 1, collegamentiDaConfermare: 1, sessioniSimulate: 1, tentativiAccesso: 1 })

    const esiste = async (p: string) => (await d.doc(p).get()).exists
    expect(await esiste('caricamenti/scaduto')).toBe(false)
    expect(await esiste('caricamenti/valido')).toBe(true)
    expect(await esiste('collegamentiInCorso/valido')).toBe(true)
    expect(await esiste('collegamentiDaConfermare/valido')).toBe(true)
    expect(await esiste('tentativiAccesso/recente')).toBe(true)
    expect(await esiste('ditte/A')).toBe(true)
    expect(await esiste('ditte/A/foto/f1')).toBe(true)
  })

  it('regge molti documenti (a blocchi)', async () => {
    const batch = d.batch()
    for (let i = 0; i < 450; i++) batch.set(d.doc(`caricamenti/c${i}`), { scadeIl: fra(-1) })
    await batch.commit()
    const esito = await eseguiPulizia(d, ORA)
    expect(esito.caricamenti).toBe(450)
    expect((await d.collection('caricamenti').get()).size).toBe(0)
  })
})
