# Foto Cantieri

Servizio in abbonamento per ditte di installatori: gli operatori scattano foto in cantiere
e le salvano per commessa nel **Google Drive (o OneDrive) della ditta**. Sui nostri server
restano solo dati gestionali e l'indice dei file.

Per ora si lavora **solo in locale con gli emulatori Firebase** (progetto `demo-foto-cantieri`):
nessun progetto reale, nessun deploy.

## Requisiti

- Node.js 22
- Java 21 (serve all'emulatore di Firestore)

## Comandi

Dalla cartella `foto-cantieri/`:

| Comando | Cosa fa |
|---|---|
| `npm run setup` | Installa le dipendenze (radice, `app/`, `functions/`) |
| `npm run emulatori` | Compila le Functions e avvia gli emulatori. I dati restano in `.dati-emulatori/` tra un avvio e l'altro |
| `npm run app` | Avvia l'app (Vite) su http://localhost:5173 |
| `npm test` | Avvia gli emulatori, esegue le prove in `tests/` e li spegne |

Pannello degli emulatori: http://localhost:4000

Si usano due terminali: nel primo `npm run emulatori`, nel secondo `npm run app`.

### Provare dal telefono

Telefono e computer sulla stessa rete Wi-Fi: apri `http://<IP-del-computer>:5173`.
L'app si collega agli emulatori sullo stesso indirizzo della pagina (gli emulatori ascoltano
su `0.0.0.0`). La fotocamera e l'installazione come app richiedono HTTPS fuori da `localhost`:
per quelle prove servirà un tunnel HTTPS (lo prepariamo al passo 6).

## Struttura

```
foto-cantieri/
├── firebase.json           configurazione emulatori, hosting, functions
├── .firebaserc             progetto demo-foto-cantieri
├── firestore.rules         regole di sicurezza (isolamento per dittaId)
├── firestore.indexes.json  indici (galleria per commessa)
├── app/                    PWA: React + Vite + TypeScript + vite-plugin-pwa
│   ├── public/             icone e favicon
│   └── src/
│       ├── firebase.ts     inizializzazione e collegamento agli emulatori
│       └── App.tsx         interfaccia (in italiano, pensata per il telefono)
├── functions/              Cloud Functions in TypeScript (regione europe-west1)
│   └── src/index.ts
└── tests/                  prove con gli emulatori (vitest)
```

## Perché React + Vite

- **Vite**: avvio e ricarica istantanei in sviluppo, build piccola; `vite-plugin-pwa`
  genera manifest e service worker (Workbox) per l'installazione sul telefono.
- **React + TypeScript**: ecosistema più diffuso, facile trovare chi lo mantiene;
  TypeScript condiviso con le Functions per il modello dati.
- Niente framework con rendering lato server (Next.js ecc.): l'app è tutta lato
  client e va ospitata su Firebase Hosting come file statici.
