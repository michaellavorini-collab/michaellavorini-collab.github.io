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

## Accesso del titolare (passo 3)

1. Avvia emulatori e app (vedi sopra), apri http://localhost:5173.
2. **Entra con Google**: con gli emulatori si apre una finestra finta di Google.
   Scegli *Add new account*, inserisci un'email qualsiasi e conferma.
3. Scrivi il nome della ditta e premi **Crea la ditta**: compare il codice ditta di 6 caratteri.
4. Nel pannello http://localhost:4000 vedi la ditta in Firestore (`ditte`, `codiciDitta`, `titolari`)
   e in *Authentication* l'utente con i permessi `{"dittaId": …, "ruolo": "titolare"}`.

La Function `creaDitta` accetta solo utenti entrati con Google, crea una sola ditta per titolare
(richiamarla restituisce quella esistente) e assegna al token `dittaId` e `ruolo`.

## Operatori (passo 4)

Il titolare, nella scheda **Operatori**, aggiunge un operatore: compare il suo codice personale
di 5 cifre **una sola volta** (si salva solo un'impronta HMAC con un segreto, non il codice).
Da lì può generare un **nuovo codice** (il vecchio smette subito di valere) e **disattivare/riattivare**.

L'operatore entra dalla pagina iniziale con **codice ditta + codice personale**. La Function
`accessoOperatore` verifica i codici e restituisce un token Firebase con `dittaId`, `ruolo: "operatore"`
e `operatoreId`.

- Codici sbagliati: stesso messaggio sia per ditta che per codice personale (non si rivela quale).
- Dopo 5 errori dallo stesso dispositivo sulla stessa ditta, blocco di 15 minuti
  (e oltre 50 errori sulla ditta da qualunque dispositivo). L'IP si salva solo come impronta.
- **Disattivazione immediata**: regole Firestore e Functions controllano `attivo` a ogni richiesta;
  la Function `impostaOperatoreAttivo` chiude anche le sessioni (il token non si rinnova).
  L'operatore che ha l'app aperta viene riportato alla pagina di accesso con un avviso.

Per provarlo servono due finestre (per esempio una normale e una in incognito):
1. titolare: scheda **Operatori** → aggiungi "Mario" e annota il codice; scheda **Commesse** → aggiungi una commessa;
2. operatore: codice ditta + codice di Mario → vede le commesse attive;
3. titolare: **Disattiva** Mario → nella finestra dell'operatore compare "accesso disattivato";
4. operatore: prova 5 volte un codice sbagliato → al sesto tentativo "Troppi tentativi".

### Segreti locali

`npm run setup` (e ogni avvio di emulatori o test) crea `functions/.secret.local` con valori casuali
per `PEPE_CODICI_OPERATORE` e `CHIAVE_CIFRATURA_ARCHIVIO` (più la riga vuota `GOOGLE_CLIENT_SECRET=`
da compilare a mano, vedi passo 5). Il file non va su git.
Se lo cancelli, i codici operatore già creati smettono di funzionare: rigenerali dalla scheda Operatori.

## Google Drive (passo 5)

Le foto non passano mai dai nostri server: vanno nel Drive del titolare, cartella **Foto Cantieri**.
Si chiede **solo** il permesso `drive.file` (l'app vede solo i file che crea lei).

Flusso: il titolare preme **Collega Google Drive** → `driveAvviaCollegamento` crea uno "stato" monouso
(10 minuti, contro i collegamenti falsificati) e restituisce l'indirizzo di consenso Google →
Google rimanda a `driveRitorno`, che scambia il codice, **cifra il refresh token** (AES-256-GCM, legato
al `dittaId`) in `credenzialiArchivio`, crea (o ritrova) la cartella e torna all'app.
**Scollega** revoca il permesso su Google e cancella le credenziali; le foto restano nel Drive.

Tutto il resto dell'app passa dall'interfaccia `Archivio` (`functions/src/archivio/`):
`GoogleDriveArchivio` per Drive, `ArchivioSimulato` per lo sviluppo; `fabbrica.ts` sceglie quale.

### Configurare il client OAuth di test

Nella Google Cloud Console, client OAuth di tipo **Applicazione web**:
- URI di reindirizzamento autorizzato: `http://localhost:5001/demo-foto-cantieri/europe-west1/driveRitorno`
- schermata di consenso: aggiungi il tuo account tra gli **utenti di test**; ambito `.../auth/drive.file`
- abilita la **Google Drive API** nel progetto.

Poi, sul tuo computer (file esclusi da git, creati al primo avvio degli emulatori):
- `functions/.env.local` → `GOOGLE_CLIENT_ID=...apps.googleusercontent.com`
- `functions/.secret.local` → `GOOGLE_CLIENT_SECRET=...`

Riavvia gli emulatori. Se apri l'app da un altro indirizzo (es. dal telefono `http://192.168.1.20:5173`)
aggiungilo a `ORIGINI_APP` in `functions/.env.local`.

### Senza client OAuth: archivio di prova

In sviluppo la scheda Ditta mostra **Usa archivio di prova**: le "cartelle" diventano cartelle
sul tuo computer in `foto-cantieri/.archivio-simulato/<dittaId>/Foto Cantieri/` (esclusa da git).
Funziona solo con gli emulatori: in produzione la Function lo rifiuta.

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
│       ├── sessione.tsx    utente collegato, ditta e ruolo dal token
│       ├── App.tsx         sceglie la pagina in base alla sessione
│       └── pagine/         Accesso, CreaDitta, HomeTitolare (+ SezioneOperatori,
│                           SezioneCommesse), HomeOperatore
├── functions/              Cloud Functions in TypeScript (regione europe-west1)
│   └── src/
│       ├── index.ts        elenco delle Functions
│       ├── comune.ts       accesso a Firestore/Auth, errori in italiano
│       ├── cifratura.ts    AES-256-GCM per i token dell'archivio
│       ├── accesso/        creaDitta, operatori, accessoOperatore,
│       │                   codiciOperatore (impronte), tentativi (blocco errori)
│       ├── archivio/       Archivio (interfaccia), GoogleDriveArchivio, ArchivioSimulato, fabbrica
│       └── drive/          oauth (Google), config (client e origini), collegamento (Functions)
├── scripts/                prepara-segreti.mjs (segreti locali per gli emulatori)
├── shared/modello.ts       modello dati e costanti, usati da app e Functions
└── tests/                  prove con gli emulatori (vitest)
    ├── regole.test.ts      regole di sicurezza Firestore
    ├── creaDitta.test.ts   creazione della ditta da parte del titolare
    ├── operatori.test.ts   codici operatore, accesso, blocchi, disattivazione
    ├── archivio.test.ts    cifratura, OAuth e archivi con un Google finto (senza emulatore)
    └── collegamento.test.ts collegamento/scollegamento archivio, stato OAuth monouso
```

## Modello dati

| Percorso | Contenuto | Chi scrive |
|---|---|---|
| `ditte/{dittaId}` | nome, codice ditta, titolare, sottocartelle, stato dell'archivio | Function `creaDitta`; il titolare cambia solo nome e sottocartelle |
| `ditte/{dittaId}/operatori/{id}` | nome, attivo | Function (creazione, codice, attiva/disattiva); il titolare rinomina |
| `ditte/{dittaId}/commesse/{id}` | numero, descrizione, cliente, attiva | titolare (non si cancellano: si disattivano) |
| `ditte/{dittaId}/foto/{id}` | indice: id file e cartella nell'archivio, commessa, sottocartella, chi, quando | solo Function, dopo aver verificato il file |
| `titolari/{uid}` | la ditta del titolare (impedisce doppioni) | solo Functions |
| `codiciDitta`, `codiciOperatore`, `credenzialiArchivio`, `tentativiAccesso`, `collegamentiInCorso` | codici di accesso (solo impronte), token dell'archivio cifrati, tentativi falliti | solo Functions; nessun client li legge |

I tipi completi sono in `shared/modello.ts`.

## Regole di sicurezza

Il token Firebase porta `dittaId` e `ruolo` (`titolare` o `operatore`, più `operatoreId`).

- Si vede solo la propria ditta: il `dittaId` del token deve coincidere con quello del percorso.
- L'operatore deve risultare `attivo` a **ogni** richiesta: disattivarlo lo blocca subito.
- Gli operatori vedono solo le commesse attive e la propria scheda; non scrivono nulla direttamente.
- L'indice foto e i dati riservati li scrivono solo le Functions.

Per provare solo le regole (più veloce):

```
npx firebase emulators:exec --project demo-foto-cantieri --only firestore "npx vitest run tests/regole.test.ts"
```

## Perché React + Vite

- **Vite**: avvio e ricarica istantanei in sviluppo, build piccola; `vite-plugin-pwa`
  genera manifest e service worker (Workbox) per l'installazione sul telefono.
- **React + TypeScript**: ecosistema più diffuso, facile trovare chi lo mantiene;
  TypeScript condiviso con le Functions per il modello dati.
- Niente framework con rendering lato server (Next.js ecc.): l'app è tutta lato
  client e va ospitata su Firebase Hosting come file statici.
