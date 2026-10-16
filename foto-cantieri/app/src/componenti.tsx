import type { ReactNode } from 'react'

export function Pagina({ titolo, children, azioni }: { titolo?: string; children: ReactNode; azioni?: ReactNode }) {
  return (
    <main className="pagina">
      <header className="testata">
        <img src="/favicon.svg" alt="" width={44} height={44} />
        <h1>{titolo ?? 'Foto Cantieri'}</h1>
        {azioni && <div className="testata-azioni">{azioni}</div>}
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
