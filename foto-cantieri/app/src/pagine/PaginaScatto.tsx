import { useEffect, useState } from 'react'
import type { Commessa, Ditta } from '../../../shared/modello'
import { coda, useCoda, type Fase } from '../servizi/coda'
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

const TESTO_FASE: Record<Fase, string> = {
  compressione: 'Preparazione…',
  attesa: 'In coda',
  invio: 'Invio',
  registrazione: 'Salvataggio…',
  riprova: 'In attesa',
  errore: 'Non salvata',
  fatto: 'Salvata',
}

export default function PaginaScatto({ dittaId, commessa, ditta, indietro }: {
  dittaId: string
  commessa: Commessa & { id: string }
  ditta: Ditta
  indietro: () => void
}) {
  const [sottocartella, setSottocartella] = useState(() => sottocartellaIniziale(ditta.sottocartelle))
  const voci = useCoda().filter((v) => v.commessaId === commessa.id)

  // Solo durante la compressione la foto non è ancora salvata sul telefono.
  const inPreparazione = voci.some((v) => v.fase === 'compressione')
  useEffect(() => {
    if (!inPreparazione) return
    const avvisa = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', avvisa)
    return () => window.removeEventListener('beforeunload', avvisa)
  }, [inPreparazione])

  function aggiungi(file: FileList | null) {
    for (const f of file ?? []) void coda.aggiungi(f, commessa.id, sottocartella)
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
  const salvate = voci.filter((v) => v.fase === 'fatto').length
  const daInviare = voci.length - salvate

  return (
    <Pagina titolo={commessa.numero}>
      <button className="pulsante testo indietro" onClick={indietro}>‹ Commesse</button>
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

      {voci.length > 0 && (
        <section className="scheda">
          <h2>{daInviare > 0 ? `Da inviare: ${daInviare}` : 'Foto inviate'} ({salvate}/{voci.length} salvate)</h2>
          {daInviare > 0 && (
            <p className="tenue">Le foto restano sul telefono finché non sono salvate: puoi continuare a scattare o chiudere l'app.</p>
          )}
          <ul className="coda">
            {voci.map((v) => {
              const anteprima = coda.anteprima(v.id)
              return (
                <li key={v.id} className={`coda-voce ${v.fase}`}>
                  {anteprima ? <img src={anteprima} alt="" /> : <span className="segnaposto" />}
                  <div>
                    <strong>{TESTO_FASE[v.fase]}{v.fase === 'invio' && ` ${Math.round(v.avanzamento * 100)}%`}</strong>
                    <span className="tenue">{v.sottocartella}</span>
                    {v.fase === 'invio' && <progress max={1} value={v.avanzamento} />}
                    {v.errore && <span className={v.fase === 'errore' ? 'testo-errore' : 'tenue'}>{v.errore}</span>}
                  </div>
                  {(v.fase === 'errore' || v.fase === 'riprova') && (
                    <div className="coda-azioni">
                      <button className="pulsante piccolo" onClick={() => coda.riprova(v.id)}>Riprova</button>
                      {v.fase === 'errore' && (
                        <button
                          className="pulsante piccolo testo"
                          onClick={() => confirm('Eliminare questa foto dal telefono? Non è stata salvata.') && void coda.elimina(v.id)}
                        >
                          Elimina
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
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
