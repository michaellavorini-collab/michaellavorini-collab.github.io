import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { LIMITI } from "../../../shared/modello";
import { auth, db, errore, richiediTitolare, testoObbligatorio, uidOperatore } from "../comune";
import { generaCodiceOperatore, improntaCodice, PEPE_CODICI_OPERATORE } from "./codiciOperatore";

/**
 * Assegna all'operatore un nuovo codice personale unico nella ditta,
 * cancellando quello vecchio. Va chiamata dentro una transazione.
 */
async function assegnaCodice(
  tx: FirebaseFirestore.Transaction,
  dittaId: string,
  operatoreId: string,
  vecchie: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<string> {
  const pepe = PEPE_CODICI_OPERATORE.value();
  for (let tentativo = 0; tentativo < 20; tentativo++) {
    const codice = generaCodiceOperatore();
    const rif = db().doc(`codiciOperatore/${improntaCodice(pepe, dittaId, codice)}`);
    if ((await tx.get(rif)).exists) continue;
    vecchie.forEach((v) => tx.delete(v.ref));
    tx.create(rif, { dittaId, operatoreId });
    return codice;
  }
  throw errore("internal", "Non riesco a generare un codice libero, riprova.");
}

function idOperatore(valore: unknown): string {
  if (typeof valore !== "string" || !/^[A-Za-z0-9]{1,40}$/.test(valore)) {
    throw errore("invalid-argument", "Operatore non indicato.");
  }
  return valore;
}

const codiciDi = (dittaId: string, operatoreId: string) =>
  db().collection("codiciOperatore").where("dittaId", "==", dittaId).where("operatoreId", "==", operatoreId);

/**
 * Il titolare crea un operatore. Riceve: { nome }.
 * Restituisce: { operatoreId, codice }. Il codice si vede solo adesso: non viene salvato in chiaro.
 */
export const creaOperatore = onCall({ secrets: [PEPE_CODICI_OPERATORE] }, async (req) => {
  const dittaId = richiediTitolare(req);
  const nome = testoObbligatorio(req.data?.nome, "il nome dell'operatore", LIMITI.nomeOperatore);
  const rifOperatore = db().collection(`ditte/${dittaId}/operatori`).doc();

  const codice = await db().runTransaction(async (tx) => {
    const c = await assegnaCodice(tx, dittaId, rifOperatore.id, []);
    tx.create(rifOperatore, {
      nome,
      attivo: true,
      creatoIl: FieldValue.serverTimestamp(),
      aggiornatoIl: FieldValue.serverTimestamp(),
    });
    return c;
  });
  return { operatoreId: rifOperatore.id, codice };
});

/**
 * Il titolare genera un nuovo codice per un operatore (codice dimenticato o da cambiare).
 * Riceve: { operatoreId }. Il vecchio codice smette subito di funzionare
 * e le sessioni aperte vengono chiuse.
 */
export const nuovoCodiceOperatore = onCall({ secrets: [PEPE_CODICI_OPERATORE] }, async (req) => {
  const dittaId = richiediTitolare(req);
  const operatoreId = idOperatore(req.data?.operatoreId);
  const rifOperatore = db().doc(`ditte/${dittaId}/operatori/${operatoreId}`);

  const codice = await db().runTransaction(async (tx) => {
    const operatore = await tx.get(rifOperatore);
    if (!operatore.exists) throw errore("not-found", "Operatore non trovato.");
    const vecchie = (await tx.get(codiciDi(dittaId, operatoreId))).docs;
    const c = await assegnaCodice(tx, dittaId, operatoreId, vecchie);
    tx.update(rifOperatore, { aggiornatoIl: FieldValue.serverTimestamp() });
    return c;
  });
  await revocaSessioni(dittaId, operatoreId);
  return { codice };
});

async function revocaSessioni(dittaId: string, operatoreId: string): Promise<void> {
  try {
    await auth().revokeRefreshTokens(uidOperatore(dittaId, operatoreId));
  } catch (e) {
    // L'operatore non è mai entrato: non c'è niente da revocare.
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
  }
}

/**
 * Il titolare attiva o disattiva un operatore. Riceve: { operatoreId, attivo }.
 * Il blocco è immediato perché regole Firestore e Functions controllano "attivo"
 * a ogni richiesta; in più qui si chiudono le sessioni, così il token non si rinnova.
 */
export const impostaOperatoreAttivo = onCall(async (req) => {
  const dittaId = richiediTitolare(req);
  const operatoreId = idOperatore(req.data?.operatoreId);
  const attivo = req.data?.attivo;
  if (typeof attivo !== "boolean") throw errore("invalid-argument", "Indica se l'operatore è attivo.");

  const rif = db().doc(`ditte/${dittaId}/operatori/${operatoreId}`);
  await db().runTransaction(async (tx) => {
    if (!(await tx.get(rif)).exists) throw errore("not-found", "Operatore non trovato.");
    tx.update(rif, { attivo, aggiornatoIl: FieldValue.serverTimestamp() });
  });
  if (!attivo) {
    await revocaSessioni(dittaId, operatoreId);
    logger.info("Operatore disattivato, sessioni revocate", { dittaId, operatoreId });
  }
  return { attivo };
});
