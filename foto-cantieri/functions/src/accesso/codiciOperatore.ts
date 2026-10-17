import { createHmac, randomInt } from "node:crypto";
import { defineSecret } from "firebase-functions/params";

/**
 * Segreto ("pepe") con cui si calcola l'impronta dei codici personali.
 * Senza questo segreto, chi leggesse il database non potrebbe risalire ai codici
 * nemmeno provando tutte le combinazioni.
 */
export const PEPE_CODICI_OPERATORE = defineSecret("PEPE_CODICI_OPERATORE");

/** Cifre del codice personale generato. */
export const CIFRE_CODICE_OPERATORE = 8;

export function generaCodiceOperatore(): string {
  return String(randomInt(10 ** CIFRE_CODICE_OPERATORE)).padStart(CIFRE_CODICE_OPERATORE, "0");
}

/** Impronta del codice personale, unica per ditta: è l'id del documento in codiciOperatore. */
export function improntaCodice(pepe: string, dittaId: string, codice: string): string {
  return createHmac("sha256", pepe).update(`${dittaId}:${codice}`).digest("hex");
}
