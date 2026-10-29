// Legge il file client_secret_*.json scaricato da Google Cloud (il più recente nella cartella
// Download, oppure quello indicato come argomento) e scrive:
//   functions/.env.local     GOOGLE_CLIENT_ID=...
//   functions/.secret.local  GOOGLE_CLIENT_SECRET=...
// Entrambi i file sono esclusi da git. Il secret non viene mai stampato.
//
// Uso (dalla cartella foto-cantieri):  node scripts/importa-credenziali-google.mjs [percorso/del/file.json]
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const radice = fileURLToPath(new URL('..', import.meta.url))

function trovaFile() {
  if (process.argv[2]) return process.argv[2]
  const cartelle = ['Downloads', 'Download', 'Scaricati'].map((n) => join(homedir(), n)).filter(existsSync)
  const candidati = cartelle.flatMap((c) =>
    readdirSync(c).filter((n) => /^client_secret_.*\.json$/.test(n)).map((n) => join(c, n)),
  )
  if (!candidati.length) {
    throw new Error(`Nessun file client_secret_*.json trovato in: ${cartelle.join(', ') || 'cartella Download'}`)
  }
  return candidati.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

/** Imposta CHIAVE=valore nel file, sostituendo la riga se c'è già. */
function imposta(file, chiave, valore) {
  let testo = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const riga = new RegExp(`^${chiave}=.*$`, 'm')
  if (riga.test(testo)) testo = testo.replace(riga, `${chiave}=${valore}`)
  else testo += `${testo && !testo.endsWith('\n') ? '\n' : ''}${chiave}=${valore}\n`
  writeFileSync(file, testo, { mode: 0o600 })
}

const file = trovaFile()
const dati = JSON.parse(readFileSync(file, 'utf8'))
const client = dati.web
if (!client) throw new Error('Il client OAuth non è di tipo "Applicazione web": creane uno di quel tipo.')
const { client_id: id, client_secret: secret, redirect_uris: ritorni = [] } = client
if (!id?.endsWith('.apps.googleusercontent.com') || !secret) throw new Error('Il file non contiene ID client e secret validi.')

const envLocal = join(radice, 'functions', '.env.local')
const secretLocal = join(radice, 'functions', '.secret.local')
imposta(envLocal, 'GOOGLE_CLIENT_ID', id)
imposta(secretLocal, 'GOOGLE_CLIENT_SECRET', secret)

console.log(`Credenziali lette da ${basename(file)}`)
console.log(`  ID client: ${id.slice(0, 12)}…  →  functions/.env.local`)
console.log(`  Secret: (non mostrato)  →  functions/.secret.local`)

// Controlli: i due file non devono finire su git.
for (const f of [envLocal, secretLocal]) {
  try {
    execFileSync('git', ['check-ignore', '-q', f], { cwd: radice })
  } catch {
    console.error(`ATTENZIONE: ${f} NON è escluso da git. Non fare commit finché non è nel .gitignore.`)
    process.exitCode = 1
  }
}
const atteso = 'http://localhost:5001/demo-foto-cantieri/europe-west1/driveRitorno'
if (!ritorni.includes(atteso)) {
  console.warn(`Nota: nel client manca l'URI di reindirizzamento ${atteso} (o il file è stato scaricato prima di aggiungerlo).`)
}
if (!process.exitCode) console.log('Fatto. Riavvia gli emulatori (Ctrl+C, poi npm run emulatori).')
