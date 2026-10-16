import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import type { Commessa, Ditta, Operatore } from '../../../shared/modello'
import { db } from '../firebase'
import { messaggioErrore } from '../errori'
import { useSessione } from '../sessione'
import { Caricamento, Errore, Pagina } from '../componenti'
import PaginaScatto from './PaginaScatto'

const DISATTIVATO = 'Il tuo accesso è stato disattivato. Rivolgiti al titolare.'

export default function HomeOperatore() {
  const sessione = useSessione()
  const { dittaId, operatoreId, esci } = sessione
  const [operatore, setOperatore] = useState<Operatore | null>(null)
  const [ditta, setDitta] = useState<Ditta | null>(null)
  const [commesse, setCommesse] = useState<(Commessa & { id: string })[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [sceltaId, setSceltaId] = useState<string | null>(null)

  useEffect(() => {
    // Se il titolare lo disattiva, le regole rifiutano subito le letture: si esce.
    const quandoErrore = (e: { code?: string }) =>
      e.code === 'permission-denied' ? void esci(DISATTIVATO) : setErrore(messaggioErrore(e))
    const smetti = [
      onSnapshot(doc(db, 'ditte', dittaId!, 'operatori', operatoreId!), (s) => {
        const o = s.data() as Operatore | undefined
        if (o && !o.attivo) void esci(DISATTIVATO)
        else setOperatore(o ?? null)
      }, quandoErrore),
      onSnapshot(doc(db, 'ditte', dittaId!), (s) => setDitta((s.data() as Ditta) ?? null), quandoErrore),
      onSnapshot(
        query(collection(db, 'ditte', dittaId!, 'commesse'), where('attiva', '==', true), orderBy('numero', 'desc')),
        (s) => setCommesse(s.docs.map((d) => ({ id: d.id, ...(d.data() as Commessa) }))),
        quandoErrore,
      ),
    ]
    return () => smetti.forEach((f) => f())
  }, [dittaId, operatoreId, esci])

  if (errore) return <Pagina><Errore testo={errore} /></Pagina>
  if (!operatore || !ditta || !commesse) return <Pagina><Caricamento /></Pagina>

  const scelta = commesse.find((c) => c.id === sceltaId)
  if (scelta) return <PaginaScatto commessa={scelta} ditta={ditta} indietro={() => setSceltaId(null)} />

  return (
    <Pagina titolo={`Ciao ${operatore.nome}`}>
      <p className="sottotitolo">{ditta.nome}</p>
      <section className="scheda">
        <h2>Scegli la commessa</h2>
        {commesse.length === 0 && <p>Nessuna commessa attiva. Chiedi al titolare di aggiungerne una.</p>}
        <ul className="elenco">
          {commesse.map((c) => (
            <li key={c.id}>
              <button className="voce" onClick={() => setSceltaId(c.id)}>
                <strong>{c.numero}</strong> {c.descrizione}
                {c.cliente && <span className="tenue">{c.cliente}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <button className="pulsante testo" onClick={() => esci()}>Esci</button>
    </Pagina>
  )
}
