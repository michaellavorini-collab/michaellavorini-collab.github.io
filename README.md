# Spesa Furba

App personale per la spesa, installabile su Android da Chrome.

- **Lista** della spesa, con percorso in ordine di scaffale e prodotti suggeriti dalle abitudini
- **Confronta**: supermercati vicini col GPS, stima del costo della lista, volantini cercati online da Claude o caricati da PDF/foto
- **Ricette** con ingredienti da aggiungere alla lista
- **Carte** fedeltà con codice a barre
- **Storico** degli scontrini fotografati

I dati restano sul telefono. La chiave API di Claude si inserisce nelle Impostazioni e resta salvata solo sul telefono.

## Struttura

- `src/page.html`: la pagina dell'app (la stessa della versione su claude.ai)
- `src/app-extra.js`: impostazioni, GPS, volantini online, backup, service worker
- `src/claude.js`: collegamento a Claude con l'SDK ufficiale `@anthropic-ai/sdk`
- `build.py`: costruisce `index.html` da `src/page.html` + `src/app-extra.js`
- `claude.js`, `index.html`, `sw.js`, `manifest.webmanifest`, `icons/`: i file pubblicati

## Aggiornare

```
npm install
npm run build
```

Quando cambi i file pubblicati, aumenta `VERSION` in `sw.js` così i telefoni scaricano la nuova versione.

# Riunioni

App per le riunioni con più persone, in `riunioni/` (pubblicata su `/riunioni/`, installabile come app a sé).

- **Trascrizione dal vivo** con il riconoscimento vocale del browser (Chrome su Android/PC, Safari su iPhone), anche per riunioni di 2 ore e oltre: si riavvia da sola dopo i silenzi, tiene lo schermo acceso e salva di continuo sul telefono
- **Chi parla**: si tocca il nome di chi prende la parola; si può correggere dopo nella trascrizione
- **Appunti** scritti durante la riunione (decisioni, cifre), che il riepilogo considera affidabili
- **Riepilogo con Claude**, gratis con l'abbonamento: un tasto copia trascrizione e istruzioni e apre l'app Claude, poi si incolla qui la risposta (con la chiave API, facoltativa, si fa in automatico): sintesi, decisioni, cose da fare (chi/entro quando), argomenti, questioni aperte
- **Condivisione**: WhatsApp e altre app, email, copia, PDF/stampa, file di testo
- **Importa** trascrizioni di Teams, Meet o Zoom (.vtt, .srt, .txt) per le riunioni online

Usa lo stesso `claude.js` e la stessa chiave API di Spesa Furba. Non ha passaggi di build: si modifica direttamente `riunioni/index.html`.
Quando cambi i file di `riunioni/`, aumenta `VERSION` in `riunioni/sw.js`.
