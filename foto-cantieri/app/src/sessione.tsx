import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onIdTokenChanged, signOut, type User } from 'firebase/auth'
import type { Ruolo } from '../../shared/modello'
import { auth } from './firebase'

export interface Sessione {
  caricamento: boolean
  utente: User | null
  dittaId?: string
  ruolo?: Ruolo
  operatoreId?: string
  /** Rilegge i permessi dal server (dopo creaDitta o login operatore). */
  aggiorna(): Promise<void>
  esci(): Promise<void>
}

const Contesto = createContext<Sessione | null>(null)

export function FornitoreSessione({ children }: { children: ReactNode }) {
  const [stato, setStato] = useState<Omit<Sessione, 'aggiorna' | 'esci'>>({ caricamento: true, utente: null })

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

  const valore: Sessione = {
    ...stato,
    // getIdToken(true) fa scattare onIdTokenChanged con i nuovi attributi.
    aggiorna: async () => void (await auth.currentUser?.getIdToken(true)),
    esci: () => signOut(auth),
  }
  return <Contesto.Provider value={valore}>{children}</Contesto.Provider>
}

export function useSessione(): Sessione {
  const s = useContext(Contesto)
  if (!s) throw new Error('useSessione fuori da FornitoreSessione')
  return s
}
