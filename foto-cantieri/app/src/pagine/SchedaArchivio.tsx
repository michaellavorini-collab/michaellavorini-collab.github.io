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

/** Esito del ritorno da Google (?drive=...), letto una volta e tolto dall'indirizzo. */
function leggiEsito(): { testo: string; ok: boolean } | null {
  const p = new URLSearchParams(window.location.search)
  const esito = p.get('drive')
  if (!esito) return null
  p.delete('drive')
  const resto = p.toString()
  window.history.replaceState(null, '', window.location.pathname + (resto ? `?${resto}` : ''))
  return ESITI[esito] ?? ESITI.errore
}

export default function SchedaArchivio({ archivio }: { archivio: InfoArchivio }) {
  const [esito, setEsito] = useState<{ testo: string; ok: boolean } | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [attesa, setAttesa] = useState(false)

  useEffect(() => setEsito(leggiEsito()), [])

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
      if (!confirm('Scollegare l\'archivio? Le foto già salvate restano nel tuo Drive, ma non se ne potranno caricare altre.')) return
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
          <button className="pulsante testo" onClick={scollega} disabled={attesa}>Scollega</button>
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
