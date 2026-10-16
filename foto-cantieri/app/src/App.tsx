import { useSessione } from './sessione'
import { Caricamento, Pagina } from './componenti'
import Accesso from './pagine/Accesso'
import CreaDitta from './pagine/CreaDitta'
import HomeTitolare from './pagine/HomeTitolare'

export default function App() {
  const s = useSessione()

  if (s.caricamento) return <Pagina><Caricamento /></Pagina>
  if (!s.utente) return <Accesso />
  if (s.ruolo === 'titolare' && s.dittaId) return <HomeTitolare />
  // Utente Google senza ditta: la crea.
  return <CreaDitta />
}
