import { randomInt } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import {
  ALFABETO_CODICE_DITTA,
  LIMITI,
  LUNGHEZZA_CODICE_DITTA,
  SOTTOCARTELLE_PREDEFINITE,
  type AttributiToken,
} from "../../../shared/modello";
import { attributi, auth, db, errore, richiediLogin, testoObbligatorio } from "../comune";

export function generaCodiceDitta(): string {
  let codice = "";
  for (let i = 0; i < LUNGHEZZA_CODICE_DITTA; i++) {
    codice += ALFABETO_CODICE_DITTA[randomInt(ALFABETO_CODICE_DITTA.length)];
  }
  return codice;
}

/**
 * Il titolare, entrato con Google, crea la sua ditta.
 * Riceve: { nome }. Restituisce: { dittaId, codiceDitta }.
 * Dopo la chiamata l'app deve rinnovare il token per vedere i nuovi permessi.
 */
export const creaDitta = onCall(async (req) => {
  const utente = richiediLogin(req);
  if (utente.token.firebase?.sign_in_provider !== "google.com") {
    throw errore("permission-denied", "Per creare una ditta serve l'accesso con un account Google.");
  }
  if (attributi(req).ruolo === "operatore") {
    throw errore("permission-denied", "Un operatore non può creare una ditta.");
  }
  const nome = testoObbligatorio(req.data?.nome, "il nome della ditta", LIMITI.nomeDitta);
  const uid = utente.uid;
  const email = utente.token.email ?? "";

  // Una sola ditta per titolare: titolari/{uid} rende la chiamata ripetibile senza doppioni.
  const rifTitolare = db().doc(`titolari/${uid}`);
  const risultato = await db().runTransaction(async (tx) => {
    const esistente = await tx.get(rifTitolare);
    if (esistente.exists) {
      const dittaId = esistente.get("dittaId") as string;
      const ditta = await tx.get(db().doc(`ditte/${dittaId}`));
      return { dittaId, codiceDitta: ditta.get("codiceDitta") as string, nuova: false };
    }

    let codiceDitta = "";
    for (let tentativo = 0; tentativo < 10 && !codiceDitta; tentativo++) {
      const candidato = generaCodiceDitta();
      if (!(await tx.get(db().doc(`codiciDitta/${candidato}`))).exists) codiceDitta = candidato;
    }
    if (!codiceDitta) throw errore("internal", "Non riesco a generare il codice ditta, riprova.");

    const rifDitta = db().collection("ditte").doc();
    tx.create(rifDitta, {
      nome,
      codiceDitta,
      titolareUid: uid,
      titolareEmail: email,
      sottocartelle: SOTTOCARTELLE_PREDEFINITE,
      archivio: { tipo: "nessuno", stato: "scollegato" },
      creataIl: FieldValue.serverTimestamp(),
      aggiornataIl: FieldValue.serverTimestamp(),
    });
    tx.create(db().doc(`codiciDitta/${codiceDitta}`), { dittaId: rifDitta.id });
    tx.create(rifTitolare, { dittaId: rifDitta.id, creatoIl: FieldValue.serverTimestamp() });
    return { dittaId: rifDitta.id, codiceDitta, nuova: true };
  });

  const nuoviAttributi: AttributiToken = { dittaId: risultato.dittaId, ruolo: "titolare" };
  await auth().setCustomUserClaims(uid, nuoviAttributi);

  return risultato;
});
