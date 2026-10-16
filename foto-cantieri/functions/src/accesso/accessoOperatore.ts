import { onCall } from "firebase-functions/v2/https";
import {
  CODICE_OPERATORE,
  codiceDittaValido,
  normalizzaCodiceDitta,
  type AttributiToken,
} from "../../../shared/modello";
import { auth, db, errore, uidOperatore } from "../comune";
import { improntaCodice, PEPE_CODICI_OPERATORE } from "./codiciOperatore";
import { azzeraTentativi, chiaviTentativi, controllaBlocco, registraErrore } from "./tentativi";

/** Stesso messaggio per ditta e codice sbagliati: non si rivela quale dei due è errato. */
const CODICI_ERRATI = "Codice ditta o codice personale non corretti.";

/**
 * L'operatore entra con codice ditta + codice personale.
 * Riceve: { codiceDitta, codicePersonale }.
 * Restituisce: { token } da usare con signInWithCustomToken; il token porta
 * dittaId, ruolo "operatore" e operatoreId.
 */
export const accessoOperatore = onCall({ secrets: [PEPE_CODICI_OPERATORE] }, async (req) => {
  const codiceDitta = normalizzaCodiceDitta(String(req.data?.codiceDitta ?? ""));
  const codicePersonale = String(req.data?.codicePersonale ?? "").trim();
  if (!codiceDitta || !codicePersonale) {
    throw errore("invalid-argument", "Inserisci il codice ditta e il tuo codice personale.");
  }

  const chiavi = chiaviTentativi(codiceDittaValido(codiceDitta) ? codiceDitta : "non-valido", req.rawRequest.ip ?? "");
  await controllaBlocco(chiavi);

  const fallito = async () => {
    await registraErrore(chiavi);
    return errore("permission-denied", CODICI_ERRATI);
  };

  if (!codiceDittaValido(codiceDitta) || !CODICE_OPERATORE.test(codicePersonale)) throw await fallito();

  const voceDitta = await db().doc(`codiciDitta/${codiceDitta}`).get();
  const dittaId = voceDitta.get("dittaId") as string | undefined;
  if (!dittaId) throw await fallito();

  const impronta = improntaCodice(PEPE_CODICI_OPERATORE.value(), dittaId, codicePersonale);
  const voceCodice = await db().doc(`codiciOperatore/${impronta}`).get();
  const operatoreId = voceCodice.get("operatoreId") as string | undefined;
  if (!operatoreId || voceCodice.get("dittaId") !== dittaId) throw await fallito();

  // I codici sono giusti: da qui in poi non è un tentativo sbagliato.
  await azzeraTentativi(chiavi);
  const operatore = await db().doc(`ditte/${dittaId}/operatori/${operatoreId}`).get();
  if (operatore.get("attivo") !== true) {
    throw errore("permission-denied", "Il tuo accesso è disattivato. Rivolgiti al titolare.");
  }

  const attributi: AttributiToken = { dittaId, ruolo: "operatore", operatoreId };
  const token = await auth().createCustomToken(uidOperatore(dittaId, operatoreId), attributi);
  return { token };
});
