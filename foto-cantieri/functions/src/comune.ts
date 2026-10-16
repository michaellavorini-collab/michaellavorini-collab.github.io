import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { AttributiToken } from "../../shared/modello";

export const db = () => getFirestore();
export const auth = () => getAuth();

/** Errore mostrato all'utente: il messaggio è in italiano e arriva così all'app. */
export function errore(
  codice: ConstructorParameters<typeof HttpsError>[0],
  messaggio: string,
): HttpsError {
  return new HttpsError(codice, messaggio);
}

export function richiediLogin(req: CallableRequest): NonNullable<CallableRequest["auth"]> {
  if (!req.auth) throw errore("unauthenticated", "Devi prima accedere.");
  return req.auth;
}

export function attributi(req: CallableRequest): Partial<AttributiToken> {
  const t = (req.auth?.token ?? {}) as Record<string, unknown>;
  return {
    dittaId: typeof t.dittaId === "string" ? t.dittaId : undefined,
    ruolo: t.ruolo === "titolare" || t.ruolo === "operatore" ? t.ruolo : undefined,
    operatoreId: typeof t.operatoreId === "string" ? t.operatoreId : undefined,
  };
}

/** Testo obbligatorio, ripulito dagli spazi, entro una lunghezza massima. */
export function testoObbligatorio(valore: unknown, nomeCampo: string, massimo: number): string {
  if (typeof valore !== "string" || !valore.trim()) {
    throw errore("invalid-argument", `Manca ${nomeCampo}.`);
  }
  const t = valore.trim().replace(/\s+/g, " ");
  if (t.length > massimo) {
    throw errore("invalid-argument", `${nomeCampo} è troppo lungo (massimo ${massimo} caratteri).`);
  }
  return t;
}

/** Il chiamante deve essere il titolare di una ditta: restituisce il dittaId. */
export function richiediTitolare(req: CallableRequest): string {
  richiediLogin(req);
  const { ruolo, dittaId } = attributi(req);
  if (ruolo !== "titolare" || !dittaId) {
    throw errore("permission-denied", "Solo il titolare può fare questa operazione.");
  }
  return dittaId;
}

/** Uid Firebase dell'operatore: stabile, così si possono revocare le sue sessioni. */
export function uidOperatore(dittaId: string, operatoreId: string): string {
  return `op_${dittaId}_${operatoreId}`;
}

export interface Membro {
  dittaId: string;
  ruolo: "titolare" | "operatore";
  operatoreId?: string;
  /** Nome da mostrare come autore delle foto. */
  autore: string;
}

/**
 * Il chiamante deve appartenere alla ditta: titolare, oppure operatore ancora attivo
 * (controllato a ogni chiamata, come nelle regole Firestore).
 */
export async function richiediMembro(req: CallableRequest): Promise<Membro> {
  const utente = richiediLogin(req);
  const { ruolo, dittaId, operatoreId } = attributi(req);
  if (ruolo === "titolare" && dittaId) {
    return { dittaId, ruolo, autore: String(utente.token.name ?? utente.token.email ?? "Titolare") };
  }
  if (ruolo === "operatore" && dittaId && operatoreId) {
    const op = await db().doc(`ditte/${dittaId}/operatori/${operatoreId}`).get();
    if (op.get("attivo") !== true) {
      throw errore("permission-denied", "Il tuo accesso è stato disattivato. Rivolgiti al titolare.");
    }
    return { dittaId, ruolo, operatoreId, autore: String(op.get("nome")) };
  }
  throw errore("permission-denied", "Non fai parte di una ditta.");
}

/** Id di documento passato dal client: solo lettere, cifre, - e _. */
export function idValido(valore: unknown, cosa: string): string {
  if (typeof valore !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(valore)) {
    throw errore("invalid-argument", `${cosa} non valido.`);
  }
  return valore;
}
