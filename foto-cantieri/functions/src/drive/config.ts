import { defineSecret, defineString } from "firebase-functions/params";
import type { ConfigOAuth } from "./oauth";

/**
 * Client OAuth di Google. In locale:
 *   functions/.env.local     GOOGLE_CLIENT_ID=...
 *   functions/.secret.local  GOOGLE_CLIENT_SECRET=...
 * Entrambi i file sono esclusi da git.
 */
export const GOOGLE_CLIENT_ID = defineString("GOOGLE_CLIENT_ID", { default: "" });
export const GOOGLE_CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");

/** Indirizzo a cui Google rimanda dopo il consenso (va registrato nel client OAuth). */
export const URL_RITORNO_DRIVE = defineString("URL_RITORNO_DRIVE", {
  default: "http://localhost:5001/demo-foto-cantieri/europe-west1/driveRitorno",
});

/** Indirizzi da cui può essere aperta l'app, separati da virgola. */
export const ORIGINI_APP = defineString("ORIGINI_APP", {
  default: "http://localhost:5173,http://127.0.0.1:5173",
});

export function clientIdConfigurato(): boolean {
  return GOOGLE_CLIENT_ID.value().trim() !== "";
}

/** Configurazione completa (con il secret): solo nelle Functions che dichiarano GOOGLE_CLIENT_SECRET. */
export function configOAuth(): ConfigOAuth {
  return {
    clientId: GOOGLE_CLIENT_ID.value().trim(),
    clientSecret: GOOGLE_CLIENT_SECRET.value().trim(),
    urlRitorno: URL_RITORNO_DRIVE.value().trim(),
  };
}

export function origineConsentita(origine: string | undefined): origine is string {
  if (!origine) return false;
  return ORIGINI_APP.value().split(",").map((o) => o.trim().replace(/\/$/, "")).includes(origine);
}
