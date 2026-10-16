/** Strumenti comuni per le prove che passano da Auth e Functions emulate. */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithCustomToken,
  type Auth,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { getApps as getAdminApps, initializeApp as initAdmin } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

export const PROGETTO = 'demo-foto-cantieri'
const HOST = '127.0.0.1'

process.env.FIRESTORE_EMULATOR_HOST ??= `${HOST}:8080`
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${HOST}:9099`
if (!getAdminApps().length) initAdmin({ projectId: PROGETTO })
/** Accesso amministrativo agli emulatori, per preparare e controllare i dati. */
export const admin = { db: getAdminFirestore(), auth: getAdminAuth() }

export async function svuotaEmulatori() {
  await fetch(`http://${HOST}:9099/emulator/v1/projects/${PROGETTO}/accounts`, { method: 'DELETE' })
  await fetch(`http://${HOST}:8080/emulator/v1/projects/${PROGETTO}/databases/(default)/documents`, { method: 'DELETE' })
}

const app_aperte: FirebaseApp[] = []
let contatore = 0

export interface Client {
  auth: Auth
  db: Firestore
  chiama<T = unknown>(nome: string, dati?: unknown): Promise<T>
}

function nuovoClient(): Client {
  const app = initializeApp({ projectId: PROGETTO, apiKey: 'demo-api-key' }, `prova-${++contatore}`)
  app_aperte.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true })
  const functions = getFunctions(app, 'europe-west1')
  connectFunctionsEmulator(functions, HOST, 5001)
  const db = getFirestore(app)
  connectFirestoreEmulator(db, HOST, 8080)
  return {
    auth,
    db,
    async chiama<T>(nome: string, dati?: unknown) {
      const { data } = await httpsCallable(functions, nome)(dati)
      return data as T
    },
  }
}

/** Client senza login. */
export const clientAnonimo = () => nuovoClient()

/** Client entrato con un account Google finto (l'emulatore accetta un id_token in JSON). */
export async function clientGoogle(email: string): Promise<Client> {
  const c = nuovoClient()
  const idToken = JSON.stringify({ sub: `google-${email}`, email, email_verified: true })
  await signInWithCredential(c.auth, GoogleAuthProvider.credential(idToken))
  return c
}

/** Client entrato con email e password (non deve poter creare ditte). */
export async function clientEmail(email: string): Promise<Client> {
  const c = nuovoClient()
  await createUserWithEmailAndPassword(c.auth, email, 'password123')
  return c
}

/** Titolare con ditta già creata e token aggiornato. */
export async function titolareConDitta(email: string, nome = 'Ditta di prova') {
  const c = await clientGoogle(email)
  const ditta = await c.chiama<{ dittaId: string; codiceDitta: string }>('creaDitta', { nome })
  await c.auth.currentUser!.getIdToken(true)
  return { client: c, ...ditta }
}

/** Accesso operatore completo: chiama la Function e entra con il token ricevuto. */
export async function entraComeOperatore(codiceDitta: string, codicePersonale: string): Promise<Client> {
  const c = nuovoClient()
  const { token } = await c.chiama<{ token: string }>('accessoOperatore', { codiceDitta, codicePersonale })
  await signInWithCustomToken(c.auth, token)
  return c
}

export async function chiudiClient() {
  await Promise.all(app_aperte.splice(0).map((a) => deleteApp(a)))
}

/** Si aspetta che la promessa fallisca con il codice indicato (es. "functions/permission-denied"). */
export async function erroreDi(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p
  } catch (e) {
    const { code, message } = e as { code: string; message: string }
    // L'SDK aggiunge lo stato HTTP in fondo al messaggio (es. " [403]"): qui si confronta il testo.
    return { code, message: message.replace(/\s*\[\d+\]$/, '') }
  }
  throw new Error('Doveva fallire ma è riuscita')
}
