import { FirebaseError } from 'firebase/app'

const MESSAGGI: Record<string, string> = {
  'auth/popup-closed-by-user': 'Accesso annullato.',
  'auth/cancelled-popup-request': 'Accesso annullato.',
  'auth/network-request-failed': 'Nessuna connessione. Controlla la rete e riprova.',
  'functions/unavailable': 'Servizio non raggiungibile. Riprova tra poco.',
  'functions/internal': 'Errore del servizio. Riprova tra poco.',
  'permission-denied': 'Non hai i permessi per questa operazione.',
}

/** Messaggio in italiano da mostrare all'utente. */
export function messaggioErrore(e: unknown): string {
  if (e instanceof FirebaseError) {
    if (MESSAGGI[e.code]) return MESSAGGI[e.code]
    // Gli errori delle nostre Functions hanno già il messaggio in italiano.
    if (e.code.startsWith('functions/') && e.message) return e.message
  }
  return 'Qualcosa è andato storto. Riprova.'
}
