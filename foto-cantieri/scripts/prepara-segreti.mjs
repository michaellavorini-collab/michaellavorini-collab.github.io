// Crea functions/.secret.local con segreti casuali, solo se manca.
// L'emulatore delle Functions legge da qui i valori di defineSecret().
// Il file è in .gitignore: non va mai su git. In produzione si useranno i Secret di Firebase.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../functions/.secret.local', import.meta.url)
const SEGRETI = ['PEPE_CODICI_OPERATORE', 'CHIAVE_CIFRATURA_ARCHIVIO']
// Questi li inserisce a mano lo sviluppatore (dal client OAuth di Google): qui solo il segnaposto.
const DA_COMPILARE = ['GOOGLE_CLIENT_SECRET']

const attuale = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''
const manca = (nome) => !new RegExp(`^${nome}=`, 'm').test(attuale)
const mancanti = [...SEGRETI, ...DA_COMPILARE].filter(manca)
if (mancanti.length) {
  const righe = mancanti.map((nome) =>
    DA_COMPILARE.includes(nome) ? `${nome}=` : `${nome}=${randomBytes(32).toString('base64')}`,
  )
  writeFileSync(FILE, (attuale && !attuale.endsWith('\n') ? attuale + '\n' : attuale) + righe.join('\n') + '\n')
  console.log(`Segreti locali creati: ${mancanti.join(', ')}`)
}
