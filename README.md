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
