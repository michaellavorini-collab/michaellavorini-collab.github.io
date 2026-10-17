import { useEffect, useState } from 'react'
import {
  collection, getDocs, limit, onSnapshot, orderBy, query, startAfter, where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import type { Foto } from '../../../shared/modello'
import { db } from '../firebase'
import { messaggioErrore } from '../errori'
import { immagine, type Misura } from '../servizi/miniature'
import { Errore } from '../componenti'

/** Foto per pagina della galleria. */
export const PER_PAGINA = 12

type FotoConId = Foto & { id: string }

const formatoData = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

function Immagine({ fotoId, misura, alt }: { fotoId: string; misura: Misura; alt: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [tentativo, setTentativo] = useState(0)

  useEffect(() => {
    let attivo = true
    setErrore(null)
    immagine(fotoId, misura).then(
      (u) => attivo && setSrc(u),
      (e) => attivo && setErrore(messaggioErrore(e)),
    )
    return () => void (attivo = false)
  }, [fotoId, misura, tentativo])

  if (errore) {
    return (
      <button className="immagine-errore" onClick={(e) => { e.stopPropagation(); setTentativo((t) => t + 1) }}>
        {errore} Tocca per riprovare.
      </button>
    )
  }
  return src ? <img src={src} alt={alt} /> : <span className="immagine-attesa" aria-label="Caricamento" />
}

/** Galleria della commessa: più recenti prima, 12 alla volta. */
export default function Galleria({ dittaId, commessaId }: { dittaId: string; commessaId: string }) {
  const [recenti, setRecenti] = useState<QueryDocumentSnapshot[] | null>(null)
  const [precedenti, setPrecedenti] = useState<QueryDocumentSnapshot[]>([])
  const [finite, setFinite] = useState(false)
  const [attesa, setAttesa] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [aperta, setAperta] = useState<number | null>(null)

  const base = query(
    collection(db, 'ditte', dittaId, 'foto'),
    where('commessaId', '==', commessaId),
    orderBy('caricataIl', 'desc'),
  )

  // Prima pagina in tempo reale: le foto appena caricate compaiono subito in cima.
  useEffect(() => {
    setPrecedenti([])
    setFinite(false)
    return onSnapshot(query(base, limit(PER_PAGINA)), (s) => setRecenti(s.docs), (e) => setErrore(messaggioErrore(e)))
  }, [dittaId, commessaId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Unione senza doppioni (una foto nuova sposta le altre di pagina).
  const viste = new Set<string>()
  const foto: FotoConId[] = []
  for (const d of [...(recenti ?? []), ...precedenti]) {
    if (viste.has(d.id)) continue
    viste.add(d.id)
    foto.push({ id: d.id, ...(d.data() as Foto) })
  }

  async function caricaAltre() {
    const ultima = precedenti.at(-1) ?? recenti?.at(-1)
    if (!ultima) return
    setAttesa(true)
    setErrore(null)
    try {
      const s = await getDocs(query(base, startAfter(ultima), limit(PER_PAGINA)))
      setPrecedenti((p) => [...p, ...s.docs])
      if (s.size < PER_PAGINA) setFinite(true)
    } catch (e) {
      setErrore(messaggioErrore(e))
    } finally {
      setAttesa(false)
    }
  }

  if (!recenti) return <p className="caricamento">Caricamento foto…</p>

  const corrente = aperta !== null ? foto[aperta] : null
  const altre = !finite && (precedenti.length > 0 || recenti.length === PER_PAGINA)

  return (
    <>
      {foto.length === 0 ? (
        <p>Ancora nessuna foto in questa commessa.</p>
      ) : (
        <ul className="griglia">
          {foto.map((f, i) => (
            <li key={f.id}>
              <button className="tessera" onClick={() => setAperta(i)} aria-label={`Foto ${f.sottocartella} del ${formatoData.format(f.scattataIl.toDate())}`}>
                <Immagine fotoId={f.id} misura="miniatura" alt="" />
                <span className="tessera-etichetta">{f.sottocartella}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Errore testo={errore} />
      {foto.length > 0 && altre && (
        <button className="pulsante secondario" onClick={caricaAltre} disabled={attesa}>
          {attesa ? 'Caricamento…' : 'Carica altre foto'}
        </button>
      )}

      {corrente && (
        <div className="visore" role="dialog" aria-modal="true" aria-label="Foto">
          <div className="visore-immagine">
            <Immagine fotoId={corrente.id} misura="grande" alt={`Foto ${corrente.sottocartella}`} />
          </div>
          <p className="visore-info">
            <strong>{corrente.sottocartella}</strong> · {formatoData.format(corrente.scattataIl.toDate())} · {corrente.autore}
          </p>
          <div className="visore-comandi">
            <button className="pulsante secondario" disabled={aperta === 0} onClick={() => setAperta((a) => a! - 1)}>‹ Più recente</button>
            <button className="pulsante secondario" disabled={aperta === foto.length - 1} onClick={() => setAperta((a) => a! + 1)}>Più vecchia ›</button>
          </div>
          <button className="pulsante" onClick={() => setAperta(null)}>Chiudi</button>
        </div>
      )}
    </>
  )
}
