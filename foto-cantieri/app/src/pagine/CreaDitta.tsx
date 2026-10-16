import { useState, type FormEvent } from 'react'
import { httpsCallable } from 'firebase/functions'
import { LIMITI } from '../../../shared/modello'
import { functions } from '../firebase'
import { messaggioErrore } from '../errori'
import { useSessione } from '../sessione'
import { Errore, Pagina } from '../componenti'

export default function CreaDitta() {
  const sessione = useSessione()
  const [nome, setNome] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [attesa, setAttesa] = useState(false)

  async function crea(e: FormEvent) {
    e.preventDefault()
    setErrore(null)
    setAttesa(true)
    try {
      await httpsCallable(functions, 'creaDitta')({ nome })
      await sessione.aggiorna()
    } catch (err) {
      setErrore(messaggioErrore(err))
      setAttesa(false)
    }
  }

  return (
    <Pagina titolo="Nuova ditta">
      <form className="scheda" onSubmit={crea}>
        <p>
          Ciao <strong>{sessione.utente?.displayName || sessione.utente?.email}</strong>, crea la tua ditta.
          Riceverai un codice da dare ai tuoi operatori.
        </p>
        <label className="campo">
          Nome della ditta
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={LIMITI.nomeDitta}
            autoComplete="organization"
            placeholder="Es. Termoidraulica Rossi"
            required
          />
        </label>
        <button className="pulsante" disabled={attesa || !nome.trim()}>
          {attesa ? 'Creazione in corso…' : 'Crea la ditta'}
        </button>
        <Errore testo={errore} />
      </form>
      <button className="pulsante testo" onClick={sessione.esci}>
        Esci ({sessione.utente?.email})
      </button>
    </Pagina>
  )
}
