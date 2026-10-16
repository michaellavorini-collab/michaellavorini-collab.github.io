import { useState } from 'react'
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { auth } from '../firebase'
import { messaggioErrore } from '../errori'
import { Errore, Pagina } from '../componenti'

export default function Accesso() {
  const [errore, setErrore] = useState<string | null>(null)
  const [attesa, setAttesa] = useState(false)

  async function accediConGoogle() {
    setErrore(null)
    setAttesa(true)
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
    } finally {
      setAttesa(false)
    }
  }

  return (
    <Pagina>
      <section className="scheda">
        <h2>Sei un operatore?</h2>
        <p>Entra con il codice della ditta e il tuo codice personale.</p>
        <button className="pulsante" disabled>
          Accesso operatore (in arrivo)
        </button>
      </section>

      <section className="scheda">
        <h2>Sei il titolare?</h2>
        <p>Entra con il tuo account Google per creare o gestire la tua ditta.</p>
        <button className="pulsante secondario" onClick={accediConGoogle} disabled={attesa}>
          {attesa ? 'Accesso in corso…' : 'Entra con Google'}
        </button>
        <Errore testo={errore} />
      </section>
    </Pagina>
  )
}
