import { useCallback, useEffect, useRef, useState } from 'react'
import type { Commessa, Ditta } from '../../../shared/modello'
import { comprimiFoto } from '../servizi/compressione'
import { inviaByte, passi, type FotoInCoda } from '../servizi/caricamento'
import { messaggioErrore } from '../errori'
import { Pagina } from '../componenti'
import Galleria from './Galleria'

const CHIAVE_SOTTOCARTELLA = 'fotoCantieri.sottocartella'

function sottocartellaIniziale(elenco: string[]): string {
  try {
    const s = sessionStorage.getItem(CHIAVE_SOTTOCARTELLA)
    if (s && elenco.includes(s)) return s
  } catch {
    // memoria non disponibile
  }
  return elenco[0]
}

const TESTO_FASE: Record<FotoInCoda['fase'], string> = {
  attesa: 'In coda',
  compressione: 'Preparazione…',
  invio: 'Invio',
  registrazione: 'Salvataggio…',
  fatto: 'Salvata',
  errore: 'Non salvata',
}

export default function PaginaScatto({ dittaId, commessa, ditta, indietro }: {
  dittaId: string
  commessa: Commessa & { id: string }
  ditta: Ditta
  indietro: () => void
}) {
  const [sottocartella, setSottocartella] = useState(() => sottocartellaIniziale(ditta.sottocartelle))
  const [coda, setCoda] = useState<FotoInCoda[]>([])
  const inLavorazione = useRef(false)
  // La sottocartella si fissa al momento dello scatto.
  const destinazioni = useRef(new Map<string, string>())

  const aggiorna = useCallback((id: string, modifica: Partial<FotoInCoda>) => {
    setCoda((c) => c.map((f) => (f.id === id ? { ...f, ...modifica } : f)))
  }, [])

  /** Porta avanti una foto dall'ultimo passo riuscito. */
  const lavora = useCallback(async (foto: FotoInCoda) => {
    const sotto = destinazioni.current.get(foto.id)!
    let f = { ...foto }
    try {
      if (!f.compressa) {
        aggiorna(f.id, { fase: 'compressione', errore: undefined })
        f.compressa = await comprimiFoto(f.originale)
        f.anteprima = URL.createObjectURL(f.compressa.blob)
        aggiorna(f.id, { compressa: f.compressa, anteprima: f.anteprima })
      }
      if (!f.fileId) {
        const compressa = f.compressa
        aggiorna(f.id, { fase: 'invio', avanzamento: 0, errore: undefined })
        if (!f.urlCaricamento) {
          const { data } = await passi.apri(commessa.id, sotto, compressa, f.originale.lastModified || Date.now())
          f = { ...f, ...data }
          aggiorna(f.id, data)
        }
        f.fileId = await inviaByte(f.urlCaricamento!, compressa.blob, (a) => aggiorna(f.id, { avanzamento: a }))
        aggiorna(f.id, { fileId: f.fileId })
      }
      aggiorna(f.id, { fase: 'registrazione', errore: undefined })
      await passi.registra(f.idCaricamento!, f.fileId)
      aggiorna(f.id, { fase: 'fatto', avanzamento: 1 })
    } catch (e) {
      // Se l'invio si è interrotto, al nuovo tentativo si apre un caricamento nuovo.
      const ripartiDaCapo = !f.fileId ? { urlCaricamento: undefined, idCaricamento: undefined } : {}
      aggiorna(f.id, { fase: 'errore', errore: messaggioErrore(e), ...ripartiDaCapo })
    }
  }, [aggiorna, commessa.id])

  // Una foto alla volta, nell'ordine di scatto.
  useEffect(() => {
    if (inLavorazione.current) return
    const prossima = coda.find((f) => f.fase === 'attesa')
    if (!prossima) return
    inLavorazione.current = true
    void lavora(prossima).finally(() => {
      inLavorazione.current = false
      setCoda((c) => [...c])
    })
  }, [coda, lavora])

  // Avvisa se si chiude la pagina con foto non ancora salvate.
  const inSospeso = coda.some((f) => f.fase !== 'fatto' && f.fase !== 'errore')
  useEffect(() => {
    if (!inSospeso) return
    const avvisa = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', avvisa)
    return () => window.removeEventListener('beforeunload', avvisa)
  }, [inSospeso])

  // Libera le anteprime quando si esce.
  const codaRef = useRef(coda)
  codaRef.current = coda
  useEffect(() => () => codaRef.current.forEach((f) => f.anteprima && URL.revokeObjectURL(f.anteprima)), [])

  function aggiungi(file: FileList | null) {
    if (!file?.length) return
    const nuove = [...file].map((originale) => {
      const id = crypto.randomUUID()
      destinazioni.current.set(id, sottocartella)
      return { id, originale, fase: 'attesa' as const, avanzamento: 0 }
    })
    setCoda((c) => [...nuove.reverse(), ...c])
  }

  function scegliSottocartella(s: string) {
    setSottocartella(s)
    try {
      sessionStorage.setItem(CHIAVE_SOTTOCARTELLA, s)
    } catch {
      // memoria non disponibile
    }
  }

  const archivioPronto = ditta.archivio.stato === 'collegato'
  const salvate = coda.filter((f) => f.fase === 'fatto').length

  return (
    <Pagina titolo={commessa.numero}>
      <button className="pulsante testo indietro" onClick={indietro} disabled={inSospeso}>
        ‹ Commesse
      </button>
      <p className="sottotitolo">
        {commessa.descrizione}
        {commessa.cliente && <> · {commessa.cliente}</>}
      </p>

      {!archivioPronto ? (
        <p className="messaggio errore">Il titolare deve ancora collegare Google Drive: per ora non si possono salvare foto.</p>
      ) : (
        <section className="scheda">
          <fieldset className="scelta">
            <legend>Cartella</legend>
            {ditta.sottocartelle.map((s) => (
              <label key={s} className={s === sottocartella ? 'chip scelto' : 'chip'}>
                <input type="radio" name="sottocartella" value={s} checked={s === sottocartella} onChange={() => scegliSottocartella(s)} />
                {s}
              </label>
            ))}
          </fieldset>

          <label className="pulsante grande">
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { aggiungi(e.target.files); e.target.value = '' }} />
            Scatta foto
          </label>
          <label className="pulsante secondario">
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { aggiungi(e.target.files); e.target.value = '' }} />
            Scegli dalla galleria
          </label>
        </section>
      )}

      {coda.length > 0 && (
        <section className="scheda">
          <h2>Foto di questa sessione ({salvate}/{coda.length} salvate)</h2>
          <ul className="coda">
            {coda.map((f) => (
              <li key={f.id} className={`coda-voce ${f.fase}`}>
                {f.anteprima ? <img src={f.anteprima} alt="" /> : <span className="segnaposto" />}
                <div>
                  <strong>{TESTO_FASE[f.fase]}{f.fase === 'invio' && ` ${Math.round(f.avanzamento * 100)}%`}</strong>
                  <span className="tenue">{destinazioni.current.get(f.id)}</span>
                  {f.fase === 'invio' && <progress max={1} value={f.avanzamento} />}
                  {f.errore && <span className="testo-errore">{f.errore}</span>}
                </div>
                {f.fase === 'errore' && (
                  <button className="pulsante piccolo" onClick={() => aggiorna(f.id, { fase: 'attesa' })}>Riprova</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="scheda">
        <h2>Foto della commessa</h2>
        <Galleria dittaId={dittaId} commessaId={commessa.id} />
      </section>
    </Pagina>
  )
}
