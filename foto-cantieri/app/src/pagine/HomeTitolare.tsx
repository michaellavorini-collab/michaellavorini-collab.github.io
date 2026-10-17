import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import type { Ditta } from '../../../shared/modello'
import { db } from '../firebase'
import { messaggioErrore } from '../errori'
import { useSessione } from '../sessione'
import { Caricamento, Errore, Pagina, Schede } from '../componenti'
import SezioneOperatori from './SezioneOperatori'
import SezioneCommesse from './SezioneCommesse'
import SchedaArchivio from './SchedaArchivio'

type Sezione = 'ditta' | 'operatori' | 'commesse'

export default function HomeTitolare() {
  const sessione = useSessione()
  const [ditta, setDitta] = useState<Ditta | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [sezione, setSezione] = useState<Sezione>('ditta')

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'ditte', sessione.dittaId!),
        (s) => setDitta((s.data() as Ditta) ?? null),
        (e) => setErrore(messaggioErrore(e)),
      ),
    [sessione.dittaId],
  )

  if (errore) return <Pagina><Errore testo={errore} /></Pagina>
  if (!ditta) return <Pagina><Caricamento /></Pagina>

  return (
    <Pagina titolo={ditta.nome}>
      <Schede
        voci={[
          { id: 'ditta', etichetta: 'Ditta' },
          { id: 'operatori', etichetta: 'Operatori' },
          { id: 'commesse', etichetta: 'Commesse' },
        ]}
        attiva={sezione}
        onCambia={setSezione}
      />

      {sezione === 'ditta' && (
        <>
          <section className="scheda">
            <p>Codice ditta da dare agli operatori:</p>
            <p className="codice-grande" aria-label={`Codice ditta ${[...ditta.codiceDitta].join(' ')}`}>
              {ditta.codiceDitta}
            </p>
          </section>

          <SchedaArchivio archivio={ditta.archivio} />

          <button className="pulsante testo" onClick={() => sessione.esci()}>
            Esci ({sessione.utente?.email})
          </button>
        </>
      )}
      {sezione === 'operatori' && <SezioneOperatori dittaId={sessione.dittaId!} />}
      {sezione === 'commesse' && <SezioneCommesse dittaId={sessione.dittaId!} />}
    </Pagina>
  )
}
