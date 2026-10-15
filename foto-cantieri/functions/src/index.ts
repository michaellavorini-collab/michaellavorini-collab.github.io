import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";

initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

/** Controllo di base: risponde se le Functions sono raggiungibili. */
export const salute = onCall(() => ({
  ok: true,
  ora: new Date().toISOString(),
}));
