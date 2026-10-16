// Crea functions/.secret.local con segreti casuali, solo se manca.
// L'emulatore delle Functions legge da qui i valori di defineSecret().
// Il file è in .gitignore: non va mai su git. In produzione si useranno i Secret di Firebase.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../functions/.secret.local', import.meta.url)
const SEGRETI = ['PEPE_CODICI_OPERATORE', 'CHIAVE_CIFRATURA_ARCHIVIO']

const attuale = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''
const mancanti = SEGRETI.filter((nome) => !new RegExp(`^${nome}=`, 'm').test(attuale))
if (mancanti.length) {
  const righe = mancanti.map((nome) => `${nome}=${randomBytes(32).toString('base64')}`)
  writeFileSync(FILE, (attuale && !attuale.endsWith('\n') ? attuale + '\n' : attuale) + righe.join('\n') + '\n')
  console.log(`Segreti locali creati: ${mancanti.join(', ')}`)
}
