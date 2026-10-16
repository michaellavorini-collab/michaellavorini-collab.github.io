import { useSessione } from './sessione'
import { Caricamento, Pagina } from './componenti'
import Accesso from './pagine/Accesso'
import CreaDitta from './pagine/CreaDitta'
import HomeTitolare from './pagine/HomeTitolare'
import HomeOperatore from './pagine/HomeOperatore'

export default function App() {
  const s = useSessione()

  if (s.caricamento) return <Pagina><Caricamento /></Pagina>
  if (!s.utente) return <Accesso />
  if (s.ruolo === 'titolare' && s.dittaId) return <HomeTitolare />
  if (s.ruolo === 'operatore' && s.dittaId && s.operatoreId) return <HomeOperatore />
  // Utente Google senza ditta: la crea.
  return <CreaDitta />
}
