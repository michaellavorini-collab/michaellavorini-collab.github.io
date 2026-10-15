import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

type Stato = { tipo: 'attesa' } | { tipo: 'ok'; ora: string } | { tipo: 'errore'; messaggio: string }

export default function App() {
  const [stato, setStato] = useState<Stato>({ tipo: 'attesa' })

  async function verifica() {
    try {
      const salute = httpsCallable<void, { ok: boolean; ora: string }>(functions, 'salute')
      const { data } = await salute()
      setStato({ tipo: 'ok', ora: new Date(data.ora).toLocaleTimeString('it-IT') })
    } catch (e) {
      setStato({ tipo: 'errore', messaggio: (e as Error).message })
    }
  }

  return (
    <main className="pagina">
      <header className="testata">
        <img src="/favicon.svg" alt="" width={48} height={48} />
        <h1>Foto Cantieri</h1>
      </header>

      <section className="scheda">
        <p>Ambiente di prova locale (emulatori Firebase).</p>
        <button className="pulsante" onClick={verifica}>
          Verifica collegamento
        </button>
        {stato.tipo === 'ok' && <p className="messaggio ok">Collegamento riuscito alle {stato.ora}.</p>}
        {stato.tipo === 'errore' && (
          <p className="messaggio errore">Collegamento non riuscito: {stato.messaggio}</p>
        )}
      </section>
    </main>
  )
}
