import { useEffect, useState, type FormEvent } from 'react'
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { LIMITI, type Commessa } from '../../../shared/modello'
import { db } from '../firebase'
import { messaggioErrore } from '../errori'
import { Caricamento, Errore } from '../componenti'

type ConId = Commessa & { id: string }

/** Gestione essenziale delle commesse (il pannello completo arriverà più avanti). */
export default function SezioneCommesse({ dittaId }: { dittaId: string }) {
  const [commesse, setCommesse] = useState<ConId[] | null>(null)
  const [campi, setCampi] = useState({ numero: '', descrizione: '', cliente: '' })
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'ditte', dittaId, 'commesse'), orderBy('numero', 'desc')),
        (s) => setCommesse(s.docs.map((d) => ({ id: d.id, ...(d.data() as Commessa) }))),
        (e) => setErrore(messaggioErrore(e)),
      ),
    [dittaId],
  )

  async function aggiungi(e: FormEvent) {
    e.preventDefault()
    setErrore(null)
    // Si svuota subito il modulo, così si può già scrivere la commessa successiva.
    const inviati = campi
    setCampi({ numero: '', descrizione: '', cliente: '' })
    try {
      await addDoc(collection(db, 'ditte', dittaId, 'commesse'), {
        numero: inviati.numero.trim(),
        descrizione: inviati.descrizione.trim(),
        cliente: inviati.cliente.trim(),
        attiva: true,
        creataIl: serverTimestamp(),
        aggiornataIl: serverTimestamp(),
      })
    } catch (err) {
      setCampi(inviati)
      setErrore(messaggioErrore(err))
    }
  }

  async function cambiaStato(c: ConId) {
    setErrore(null)
    try {
      await updateDoc(doc(db, 'ditte', dittaId, 'commesse', c.id), { attiva: !c.attiva, aggiornataIl: serverTimestamp() })
    } catch (err) {
      setErrore(messaggioErrore(err))
    }
  }

  if (!commesse) return <Caricamento />

  const campo = (nome: keyof typeof campi, etichetta: string, massimo: number, obbligatorio = false, esempio = '') => (
    <label className="campo">
      {etichetta}
      <input
        value={campi[nome]}
        onChange={(e) => setCampi({ ...campi, [nome]: e.target.value })}
        maxLength={massimo}
        required={obbligatorio}
        placeholder={esempio}
      />
    </label>
  )

  return (
    <>
      <form className="scheda" onSubmit={aggiungi}>
        <h2>Nuova commessa</h2>
        {campo('numero', 'Numero', LIMITI.numeroCommessa, true, 'Es. 2026-015')}
        {campo('descrizione', 'Descrizione', LIMITI.descrizioneCommessa, false, 'Es. Sostituzione caldaia')}
        {campo('cliente', 'Cliente', LIMITI.clienteCommessa, false, 'Es. Rossi Mario')}
        <button className="pulsante" disabled={!campi.numero.trim()}>
          Aggiungi commessa
        </button>
      </form>

      <Errore testo={errore} />

      <section className="scheda">
        <h2>Commesse ({commesse.length})</h2>
        {commesse.length === 0 && <p>Nessuna commessa.</p>}
        <ul className="elenco">
          {commesse.map((c) => (
            <li key={c.id} className={c.attiva ? 'riga' : 'riga spenta'}>
              <div className="riga-testo">
                <strong>{c.numero}</strong>
                <span>{c.descrizione}</span>
                {c.cliente && <span className="tenue">{c.cliente}</span>}
              </div>
              <div className="riga-azioni">
                <button className={c.attiva ? 'pulsante piccolo secondario' : 'pulsante piccolo'} onClick={() => cambiaStato(c)}>
                  {c.attiva ? 'Chiudi' : 'Riapri'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
