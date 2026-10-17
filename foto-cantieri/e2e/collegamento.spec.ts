import { randomBytes, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { creaDitta, nuovoTelefono, PROGETTO, svuotaEmulatori } from './aiuti'

test.beforeEach(svuotaEmulatori)

// firebase-admin delle Functions, per preparare i dati come farebbe driveRitorno.
const richiedi = createRequire(join(import.meta.dirname, '..', 'functions', 'package.json'))
const adminApp = richiedi('firebase-admin/app') as typeof import('firebase-admin/app')
const adminFs = richiedi('firebase-admin/firestore') as typeof import('firebase-admin/firestore')
// Cifratura delle Functions (compilata da `npm run build:functions`, lanciato da test:e2e).
const { cifra } = richiedi('./lib/functions/src/cifratura.js') as typeof import('../functions/src/cifratura')

test('un link di consenso Google inoltrato non collega il Drive di chi lo apre', async ({ browser }) => {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
  const app = adminApp.getApps().find((a) => a.name === 'e2e') ?? adminApp.initializeApp({ projectId: PROGETTO }, 'e2e')
  const chiave = /^CHIAVE_CIFRATURA_ARCHIVIO=(.+)$/m.exec(
    readFileSync(join(import.meta.dirname, '..', 'functions', '.secret.local'), 'utf8'),
  )![1].trim()

  // La "vittima" è titolare di un'altra ditta.
  const { pagina } = await nuovoTelefono(browser)
  await creaDitta(pagina, 'vittima@gmail.com', 'Elettrica Bianchi')

  // Consenso completato su Google per un collegamento avviato da qualcun altro.
  const conferma = randomBytes(32).toString('base64url')
  await adminFs.getFirestore(app)
    .doc(`collegamentiDaConfermare/${createHash('sha256').update(conferma).digest('hex')}`)
    .set({
      dittaId: 'dittaAttaccante', uid: 'uidAttaccante',
      cifrato: cifra('1//token-di-prova', 'dittaAttaccante', chiave),
      scadeIl: adminFs.Timestamp.fromMillis(Date.now() + 10 * 60_000),
    })

  await pagina.goto(`/?drive=conferma#conferma=${conferma}`)
  await expect(pagina.getByText('Questo collegamento è stato avviato da un altro account: per sicurezza è stato annullato.')).toBeVisible()
  // Il codice di conferma sparisce dall'indirizzo.
  expect(pagina.url()).toBe('http://localhost:5173/')
  await expect(pagina.getByText('Le foto si salvano nel')).toBeVisible()
})
