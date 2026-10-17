import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onIdTokenChanged, signOut, type User } from 'firebase/auth'
import type { Ruolo } from '../../shared/modello'
import { auth } from './firebase'
import { svuotaImmagini } from './servizi/miniature'

export interface Sessione {
  caricamento: boolean
  utente: User | null
  dittaId?: string
  ruolo?: Ruolo
  operatoreId?: string
  /** Messaggio da mostrare nella pagina di accesso (es. "accesso disattivato"). */
  avviso: string | null
  /** Rilegge i permessi dal server (dopo creaDitta o login operatore). */
  aggiorna(): Promise<void>
  esci(avviso?: string): Promise<void>
}

const Contesto = createContext<Sessione | null>(null)

export function FornitoreSessione({ children }: { children: ReactNode }) {
  const [stato, setStato] = useState<Omit<Sessione, 'aggiorna' | 'esci' | 'avviso'>>({ caricamento: true, utente: null })
  const [avviso, setAvviso] = useState<string | null>(null)

  useEffect(
    () =>
      onIdTokenChanged(auth, async (utente) => {
        if (!utente) return setStato({ caricamento: false, utente: null })
        const { claims } = await utente.getIdTokenResult()
        setStato({
          caricamento: false,
          utente,
          dittaId: typeof claims.dittaId === 'string' ? claims.dittaId : undefined,
          ruolo: claims.ruolo === 'titolare' || claims.ruolo === 'operatore' ? claims.ruolo : undefined,
          operatoreId: typeof claims.operatoreId === 'string' ? claims.operatoreId : undefined,
        })
      }),
    [],
  )

  // getIdToken(true) fa scattare onIdTokenChanged con i nuovi attributi.
  const aggiorna = useCallback(async () => void (await auth.currentUser?.getIdToken(true)), [])
  const esci = useCallback(async (testo?: string) => {
    setAvviso(testo ?? null)
    svuotaImmagini()
    await signOut(auth)
  }, [])
  const valore = useMemo<Sessione>(() => ({ ...stato, avviso, aggiorna, esci }), [stato, avviso, aggiorna, esci])
  return <Contesto.Provider value={valore}>{children}</Contesto.Provider>
}

export function useSessione(): Sessione {
  const s = useContext(Contesto)
  if (!s) throw new Error('useSessione fuori da FornitoreSessione')
  return s
}
