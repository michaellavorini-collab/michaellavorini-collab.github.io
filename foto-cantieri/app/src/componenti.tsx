import type { ReactNode } from 'react'

export function Pagina({ titolo, children }: { titolo?: string; children: ReactNode }) {
  return (
    <main className="pagina">
      <header className="testata">
        <img src="/favicon.svg" alt="" width={44} height={44} />
        <h1>{titolo ?? 'Foto Cantieri'}</h1>
      </header>
      {children}
    </main>
  )
}

export function Errore({ testo }: { testo: string | null }) {
  return testo ? <p className="messaggio errore" role="alert">{testo}</p> : null
}

export function Caricamento() {
  return <p className="caricamento" aria-live="polite">Caricamento…</p>
}

/** Schede in alto (es. Ditta / Operatori / Commesse). */
export function Schede<T extends string>({ voci, attiva, onCambia }: {
  voci: { id: T; etichetta: string }[]
  attiva: T
  onCambia: (id: T) => void
}) {
  return (
    <nav className="schede" role="tablist">
      {voci.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={v.id === attiva}
          className={v.id === attiva ? 'scheda-tab attiva' : 'scheda-tab'}
          onClick={() => onCambia(v.id)}
        >
          {v.etichetta}
        </button>
      ))}
    </nav>
  )
}
