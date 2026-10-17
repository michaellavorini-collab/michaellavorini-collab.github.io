import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'

// Per ora si lavora solo con gli emulatori: progetto "demo-", nessuna chiave reale.
export const PROGETTO = 'demo-foto-cantieri'
export const REGIONE = 'europe-west1'

const app = initializeApp({
  projectId: PROGETTO,
  apiKey: 'demo-api-key',
  authDomain: `${PROGETTO}.firebaseapp.com`,
})

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, REGIONE)

// Gli emulatori si raggiungono sullo stesso host della pagina,
// così funziona anche dal telefono collegato alla stessa rete.
const host = window.location.hostname
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
connectFirestoreEmulator(db, host, 8080)
connectFunctionsEmulator(functions, host, 5001)

/** Indirizzo base delle Functions HTTP (es. miniature). */
export const URL_FUNZIONI = `http://${host}:5001/${PROGETTO}/${REGIONE}`
