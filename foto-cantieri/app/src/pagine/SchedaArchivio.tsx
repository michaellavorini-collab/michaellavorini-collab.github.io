import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import type { InfoArchivio } from '../../../shared/modello'
import { functions } from '../firebase'
import { messaggioErrore } from '../errori'
import { Errore } from '../componenti'

const ESITI: Record<string, { testo: string; ok: boolean }> = {
  collegato: { testo: 'Google Drive collegato.', ok: true },
  annullato: { testo: 'Collegamento annullato.', ok: false },
  'permesso-mancante': { testo: 'Per salvare le foto serve il permesso su Google Drive: riprova e lascia la spunta.', ok: false },
  errore: { testo: 'Collegamento non riuscito. Riprova.', ok: false },
}

/**
 * Ritorno da Google: "?drive=<esito>", e per la conferma anche "#conferma=<codice>".
 * Si legge una volta sola, all'apertura della pagina, e si toglie subito dall'indirizzo.
 */
function leggiRitorno(): { esito: string; conferma: string | null } | null {
  const p = new URLSearchParams(window.location.search)
  const esito = p.get('drive')
  if (!esito) return null
  const conferma = new URLSearchParams(window.location.hash.slice(1)).get('conferma')
  p.delete('drive')
  const resto = p.toString()
  window.history.replaceState(null, '', window.location.pathname + (resto ? `?${resto}` : ''))
  return { esito, conferma }
}
const RITORNO = leggiRitorno()
let confermaInviata = false

const conferma = httpsCallable<{ conferma: string }, { account: string }>(functions, 'driveConfermaCollegamento')

export default function SchedaArchivio({ archivio }: { archivio: InfoArchivio }) {
  const [esito, setEsito] = useState<{ testo: string; ok: boolean } | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [attesa, setAttesa] = useState(false)

  useEffect(() => {
    if (!RITORNO) return
    if (RITORNO.esito !== 'conferma') return setEsito(ESITI[RITORNO.esito] ?? ESITI.errore)
    // Il collegamento si completa solo con la sessione del titolare che l'ha avviato.
    if (confermaInviata || !RITORNO.conferma) return
    confermaInviata = true
    setAttesa(true)
    setEsito({ testo: 'Completamento del collegamento…', ok: true })
    conferma({ conferma: RITORNO.conferma }).then(
      () => setEsito(ESITI.collegato),
      (e) => {
        setEsito(null)
        setErrore(messaggioErrore(e))
      },
    ).finally(() => setAttesa(false))
  }, [])

  async function esegui(azione: () => Promise<void>) {
    setErrore(null)
    setEsito(null)
    setAttesa(true)
    try {
      await azione()
    } catch (e) {
      setErrore(messaggioErrore(e))
    } finally {
      setAttesa(false)
    }
  }

  const collegaDrive = () =>
    esegui(async () => {
      const { data } = await httpsCallable<void, { url: string }>(functions, 'driveAvviaCollegamento')()
      window.location.assign(data.url)
    })
  const collegaProva = () => esegui(async () => void (await httpsCallable(functions, 'collegaArchivioSimulato')()))
  const scollega = () =>
    esegui(async () => {
      // Il messaggio dice chiaramente cosa succede: "Scollega" non è "Esci".
      if (!confirm(
        `Vuoi davvero scollegare ${nomeTipo} dalla ditta?\n\n` +
        'Gli operatori non potranno più caricare foto finché non lo ricolleghi. ' +
        'Le foto già salvate restano nel tuo Drive.\n\n' +
        'Per uscire dall\'app premi Annulla e usa «Esci».',
      )) return
      await httpsCallable(functions, 'scollegaArchivio')()
    })

  const collegato = archivio.stato === 'collegato'
  const nomeTipo = archivio.tipo === 'simulato' ? 'Archivio di prova' : 'Google Drive'

  return (
    <section className="scheda">
      <h2>{collegato ? nomeTipo : 'Google Drive'}</h2>
      {esito && <p className={esito.ok ? 'messaggio ok' : 'messaggio errore'} role="status">{esito.testo}</p>}

      {collegato ? (
        <>
          <p>
            Collegato{archivio.account ? <> a <strong>{archivio.account}</strong></> : null}. Le foto vanno nella cartella
            «Foto Cantieri».
          </p>
          {archivio.tipo === 'googleDrive' && archivio.cartellaRadiceId && (
            <a
              className="pulsante secondario link"
              href={`https://drive.google.com/drive/folders/${encodeURIComponent(archivio.cartellaRadiceId)}`}
              target="_blank"
              rel="noreferrer"
            >
              Apri la cartella su Drive
            </a>
          )}
          <button className="pulsante testo rischio" onClick={scollega} disabled={attesa}>
            Scollega {nomeTipo}
          </button>
        </>
      ) : (
        <>
          {archivio.stato === 'errore' && (
            <p className="messaggio errore">Google Drive non risponde più (permesso revocato?). Ricollegalo.</p>
          )}
          <p>
            Le foto si salvano nel <strong>tuo</strong> Google Drive, nella cartella «Foto Cantieri».
            L'app chiede solo il permesso di vedere i file che crea lei: il resto del tuo Drive resta privato.
          </p>
          <button className="pulsante" onClick={collegaDrive} disabled={attesa}>
            {attesa ? 'Attendi…' : 'Collega Google Drive'}
          </button>
          {import.meta.env.DEV && (
            <button className="pulsante secondario" onClick={collegaProva} disabled={attesa}>
              Usa archivio di prova (solo sviluppo)
            </button>
          )}
        </>
      )}
      <Errore testo={errore} />
    </section>
  )
}
