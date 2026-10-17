import { useState, type FormEvent } from 'react'
import { GoogleAuthProvider, signInWithCustomToken, signInWithPopup, signInWithRedirect } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { httpsCallable } from 'firebase/functions'
import { LUNGHEZZA_CODICE_DITTA, LUNGHEZZA_CODICE_OPERATORE, normalizzaCodiceDitta } from '../../../shared/modello'
import { auth, functions } from '../firebase'
import { messaggioErrore } from '../errori'
import { useSessione } from '../sessione'
import { Errore, Pagina } from '../componenti'

const CHIAVE_CODICE_DITTA = 'fotoCantieri.codiceDitta'

function leggiCodiceDitta(): string {
  try {
    return localStorage.getItem(CHIAVE_CODICE_DITTA) ?? ''
  } catch {
    return ''
  }
}

export default function Accesso() {
  const { avviso } = useSessione()
  const [codiceDitta, setCodiceDitta] = useState(leggiCodiceDitta)
  const [codicePersonale, setCodicePersonale] = useState('')
  const [errore, setErrore] = useState<string | null>(avviso)
  const [attesa, setAttesa] = useState<'operatore' | 'titolare' | null>(null)

  async function entraOperatore(e: FormEvent) {
    e.preventDefault()
    setErrore(null)
    setAttesa('operatore')
    try {
      const codice = normalizzaCodiceDitta(codiceDitta)
      const { data } = await httpsCallable<unknown, { token: string }>(functions, 'accessoOperatore')({
        codiceDitta: codice,
        codicePersonale,
      })
      try {
        localStorage.setItem(CHIAVE_CODICE_DITTA, codice)
      } catch {
        // Memoria del browser non disponibile: pazienza, lo si riscrive la prossima volta.
      }
      await signInWithCustomToken(auth, data.token)
    } catch (err) {
      setErrore(messaggioErrore(err))
      setCodicePersonale('')
      setAttesa(null)
    }
  }

  async function entraTitolare() {
    setErrore(null)
    setAttesa('titolare')
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    try {
      await signInWithPopup(auth, provider)
    } catch (e) {
      // Alcuni telefoni bloccano le finestre: si passa al reindirizzamento.
      if (e instanceof FirebaseError && e.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider)
        return
      }
      setErrore(messaggioErrore(e))
      setAttesa(null)
    }
  }

  return (
    <Pagina>
      <form className="scheda" onSubmit={entraOperatore}>
        <h2>Accesso operatore</h2>
        <label className="campo">
          Codice ditta
          <input
            value={codiceDitta}
            onChange={(e) => setCodiceDitta(e.target.value.toUpperCase())}
            maxLength={LUNGHEZZA_CODICE_DITTA + 2}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="input-codice"
            placeholder="Es. YBTS4T"
            required
          />
        </label>
        <label className="campo">
          Codice personale
          <input
            value={codicePersonale}
            onChange={(e) => setCodicePersonale(e.target.value.replace(/\D/g, ''))}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={LUNGHEZZA_CODICE_OPERATORE}
            autoComplete="current-password"
            className="input-codice"
            required
          />
        </label>
        <button className="pulsante" disabled={attesa !== null || !codiceDitta.trim() || codicePersonale.length !== LUNGHEZZA_CODICE_OPERATORE}>
          {attesa === 'operatore' ? 'Accesso in corso…' : 'Entra'}
        </button>
        <Errore testo={errore} />
      </form>

      <section className="scheda">
        <h2>Sei il titolare?</h2>
        <p>Entra con il tuo account Google per creare o gestire la tua ditta.</p>
        <button className="pulsante secondario" onClick={entraTitolare} disabled={attesa !== null}>
          {attesa === 'titolare' ? 'Accesso in corso…' : 'Entra con Google'}
        </button>
      </section>
    </Pagina>
  )
}
