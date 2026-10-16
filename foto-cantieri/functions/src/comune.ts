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
