import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onCall, onRequest } from "firebase-functions/v2/https";
import type { Ditta, TipoArchivio } from "../../../shared/modello";
import { NOME_CARTELLA_RADICE, type Archivio } from "../archivio/Archivio";
import { ArchivioSimulato, inEmulatore } from "../archivio/ArchivioSimulato";
import { GoogleDriveArchivio } from "../archivio/GoogleDriveArchivio";
import { CHIAVE_CIFRATURA_ARCHIVIO, cifra, decifra } from "../cifratura";
import { db, errore, richiediTitolare } from "../comune";
import { clientIdConfigurato, configOAuth, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, origineConsentita, URL_RITORNO_DRIVE } from "./config";
import { ErroreOAuth, revocaToken, scambiaCodice, urlAutorizzazione } from "./oauth";

/** Minuti entro cui il titolare deve completare il consenso su Google. */
const VALIDITA_COLLEGAMENTO_MINUTI = 10;

/** Cartella radice: riusa quella già creata se esiste ancora, altrimenti la crea. */
async function cartellaRadice(archivio: Archivio, precedente: Ditta["archivio"] | undefined): Promise<string> {
  if (precedente?.tipo === archivio.tipo && precedente.cartellaRadiceId) {
    if (await archivio.cartellaEsiste(precedente.cartellaRadiceId)) return precedente.cartellaRadiceId;
  }
  return archivio.assicuraCartella(NOME_CARTELLA_RADICE);
}

async function salvaCollegamento(dittaId: string, tipo: TipoArchivio, account: string, cartellaRadiceId: string) {
  await db().doc(`ditte/${dittaId}`).update({
    archivio: { tipo, stato: "collegato", account, cartellaRadiceId, collegatoIl: FieldValue.serverTimestamp() },
    aggiornataIl: FieldValue.serverTimestamp(),
  });
}

/**
 * Il titolare avvia il collegamento a Google Drive.
 * Restituisce { url }: l'app ci manda il titolare per dare il consenso (solo drive.file).
 */
export const driveAvviaCollegamento = onCall(async (req) => {
  const dittaId = richiediTitolare(req);
  if (!clientIdConfigurato()) {
    throw errore("failed-precondition", "Google Drive non è ancora configurato su questo server.");
  }
  const origine = req.rawRequest.headers.origin;
  if (!origineConsentita(origine)) {
    throw errore("permission-denied", "Indirizzo dell'app non autorizzato.");
  }

  // Lo "stato" è un valore casuale monouso: protegge da collegamenti falsificati (CSRF).
  const stato = randomBytes(32).toString("base64url");
  await db().doc(`collegamentiInCorso/${stato}`).create({
    dittaId,
    uid: req.auth!.uid,
    origine,
    scadeIl: Timestamp.fromMillis(Date.now() + VALIDITA_COLLEGAMENTO_MINUTI * 60_000),
  });
  const url = urlAutorizzazione(
    { clientId: GOOGLE_CLIENT_ID.value(), urlRitorno: URL_RITORNO_DRIVE.value() },
    stato,
    req.auth!.token.email,
  );
  return { url };
});

function paginaErrore(messaggio: string): string {
  const testo = messaggio.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Foto Cantieri</title><body style="font-family:system-ui;padding:24px;font-size:18px">
<h1 style="color:#1f4e79">Foto Cantieri</h1><p>${testo}</p><p>Torna all'app e riprova.</p></body></html>`;
}

/** Google rimanda qui il titolare dopo il consenso. */
export const driveRitorno = onRequest(
  { secrets: [GOOGLE_CLIENT_SECRET, CHIAVE_CIFRATURA_ARCHIVIO] },
  async (req, res) => {
    const stato = typeof req.query.state === "string" ? req.query.state : "";
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(stato)) {
      res.status(400).send(paginaErrore("Richiesta di collegamento non valida."));
      return;
    }

    // Lo stato si consuma una volta sola.
    const rif = db().doc(`collegamentiInCorso/${stato}`);
    const voce = await db().runTransaction(async (tx) => {
      const d = await tx.get(rif);
      if (d.exists) tx.delete(rif);
      return d.data() as { dittaId: string; uid: string; origine: string; scadeIl: Timestamp } | undefined;
    });
    if (!voce || voce.scadeIl.toMillis() < Date.now()) {
      res.status(400).send(paginaErrore("Il collegamento è scaduto o è già stato usato."));
      return;
    }

    const torna = (esito: string) => res.redirect(303, `${voce.origine}/?drive=${esito}`);
    if (typeof req.query.error === "string") return torna("annullato");
    const codice = typeof req.query.code === "string" ? req.query.code : "";
    if (!codice) return torna("errore");

    // Chi ha avviato il collegamento deve essere ancora il titolare di quella ditta.
    const titolare = await db().doc(`titolari/${voce.uid}`).get();
    if (titolare.get("dittaId") !== voce.dittaId) return torna("errore");

    try {
      const config = configOAuth();
      const { refreshToken, accessToken, scadeIl } = await scambiaCodice(config, codice);
      const archivio = new GoogleDriveArchivio(config, refreshToken, { accessToken, scadeIl });
      const ditta = (await db().doc(`ditte/${voce.dittaId}`).get()).data() as Ditta;
      const radice = await cartellaRadice(archivio, ditta.archivio);
      const account = await archivio.account();

      await db().doc(`credenzialiArchivio/${voce.dittaId}`).set({
        tipo: "googleDrive",
        cifrato: cifra(refreshToken, voce.dittaId, CHIAVE_CIFRATURA_ARCHIVIO.value()),
        aggiornateIl: FieldValue.serverTimestamp(),
      });
      await salvaCollegamento(voce.dittaId, "googleDrive", account, radice);
      logger.info("Google Drive collegato", { dittaId: voce.dittaId });
      return torna("collegato");
    } catch (e) {
      logger.error("Collegamento Google Drive non riuscito", { dittaId: voce.dittaId, errore: String(e) });
      return torna(e instanceof ErroreOAuth && e.motivo === "permesso-mancante" ? "permesso-mancante" : "errore");
    }
  },
);

/** Il titolare scollega l'archivio. Le foto restano nel suo Drive; si cancellano solo le credenziali. */
export const scollegaArchivio = onCall({ secrets: [CHIAVE_CIFRATURA_ARCHIVIO] }, async (req) => {
  const dittaId = richiediTitolare(req);
  const rif = db().doc(`credenzialiArchivio/${dittaId}`);
  const cred = await rif.get();
  if (cred.exists && cred.get("tipo") === "googleDrive") {
    try {
      await revocaToken(decifra(cred.get("cifrato") as string, dittaId, CHIAVE_CIFRATURA_ARCHIVIO.value()));
    } catch (e) {
      logger.warn("Revoca del token non riuscita", { dittaId, errore: String(e) });
    }
  }
  await rif.delete();
  // La cartella radice si ricorda: se si ricollega lo stesso archivio, si riusa.
  await db().doc(`ditte/${dittaId}`).update({
    "archivio.stato": "scollegato",
    aggiornataIl: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/** Solo con gli emulatori: collega l'archivio simulato (cartelle sul disco del computer). */
export const collegaArchivioSimulato = onCall(async (req) => {
  const dittaId = richiediTitolare(req);
  if (!inEmulatore()) throw errore("failed-precondition", "L'archivio di prova esiste solo in sviluppo.");
  const archivio = new ArchivioSimulato(dittaId);
  const ditta = (await db().doc(`ditte/${dittaId}`).get()).data() as Ditta;
  const radice = await cartellaRadice(archivio, ditta.archivio);
  await db().doc(`credenzialiArchivio/${dittaId}`).delete();
  await salvaCollegamento(dittaId, "simulato", await archivio.account(), radice);
  return { cartellaRadiceId: radice };
});
