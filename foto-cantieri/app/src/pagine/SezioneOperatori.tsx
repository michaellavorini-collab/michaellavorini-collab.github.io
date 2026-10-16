import { useEffect, useState, type FormEvent } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { LIMITI, type Operatore } from '../../../shared/modello'
import { db, functions } from '../firebase'
import { messaggioErrore } from '../errori'
import { Caricamento, Errore } from '../componenti'

type ConId = Operatore & { id: string }

const creaOperatore = httpsCallable<{ nome: string }, { operatoreId: string; codice: string }>(functions, 'creaOperatore')
const nuovoCodice = httpsCallable<{ operatoreId: string }, { codice: string }>(functions, 'nuovoCodiceOperatore')
const impostaAttivo = httpsCallable<{ operatoreId: string; attivo: boolean }, unknown>(functions, 'impostaOperatoreAttivo')

export default function SezioneOperatori({ dittaId }: { dittaId: string }) {
  const [operatori, setOperatori] = useState<ConId[] | null>(null)
  const [nome, setNome] = useState('')
  const [codiceMostrato, setCodiceMostrato] = useState<{ nome: string; codice: string } | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [occupato, setOccupato] = useState<string | null>(null)

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'ditte', dittaId, 'operatori'), orderBy('nome')),
        (s) => setOperatori(s.docs.map((d) => ({ id: d.id, ...(d.data() as Operatore) }))),
        (e) => setErrore(messaggioErrore(e)),
      ),
    [dittaId],
  )

  async function esegui(chiave: string, azione: () => Promise<void>) {
    setErrore(null)
    setOccupato(chiave)
    try {
      await azione()
    } catch (e) {
      setErrore(messaggioErrore(e))
    } finally {
      setOccupato(null)
    }
  }

  const aggiungi = (e: FormEvent) => {
    e.preventDefault()
    void esegui('nuovo', async () => {
      const { data } = await creaOperatore({ nome })
      setCodiceMostrato({ nome: nome.trim(), codice: data.codice })
      setNome('')
    })
  }

  if (!operatori) return <Caricamento />

  return (
    <>
      {codiceMostrato && (
        <section className="scheda evidenza" role="status">
          <p>Codice personale di <strong>{codiceMostrato.nome}</strong>:</p>
          <p className="codice-grande">{codiceMostrato.codice}</p>
          <p className="tenue">Annotalo e consegnalo all'operatore: per sicurezza non sarà più visibile.</p>
          <button className="pulsante secondario" onClick={() => setCodiceMostrato(null)}>Fatto</button>
        </section>
      )}

      <form className="scheda" onSubmit={aggiungi}>
        <h2>Nuovo operatore</h2>
        <label className="campo">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={LIMITI.nomeOperatore} placeholder="Es. Mario" required />
        </label>
        <button className="pulsante" disabled={occupato !== null || !nome.trim()}>
          {occupato === 'nuovo' ? 'Creazione…' : 'Aggiungi operatore'}
        </button>
      </form>

      <Errore testo={errore} />

      <section className="scheda">
        <h2>Operatori ({operatori.length})</h2>
        {operatori.length === 0 && <p>Nessun operatore.</p>}
        <ul className="elenco">
          {operatori.map((o) => (
            <li key={o.id} className={o.attivo ? 'riga' : 'riga spenta'}>
              <div className="riga-testo">
                <strong>{o.nome}</strong>
                <span className={o.attivo ? 'etichetta ok' : 'etichetta'}>{o.attivo ? 'Attivo' : 'Disattivato'}</span>
              </div>
              <div className="riga-azioni">
                <button
                  className="pulsante piccolo secondario"
                  disabled={occupato !== null}
                  onClick={() => esegui(`codice-${o.id}`, async () => {
                    if (!confirm(`Generare un nuovo codice per ${o.nome}? Quello attuale smetterà di funzionare.`)) return
                    const { data } = await nuovoCodice({ operatoreId: o.id })
                    setCodiceMostrato({ nome: o.nome, codice: data.codice })
                  })}
                >
                  Nuovo codice
                </button>
                <button
                  className={o.attivo ? 'pulsante piccolo pericolo' : 'pulsante piccolo'}
                  disabled={occupato !== null}
                  onClick={() => esegui(`attivo-${o.id}`, async () => {
                    await impostaAttivo({ operatoreId: o.id, attivo: !o.attivo })
                  })}
                >
                  {occupato === `attivo-${o.id}` ? '…' : o.attivo ? 'Disattiva' : 'Riattiva'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
