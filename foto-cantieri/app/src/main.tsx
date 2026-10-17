import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { FornitoreSessione } from './sessione.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FornitoreSessione>
      <App />
    </FornitoreSessione>
  </StrictMode>,
)
