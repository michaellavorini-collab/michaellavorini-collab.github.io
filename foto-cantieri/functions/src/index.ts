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

export { creaDitta } from "./accesso/creaDitta";
export { creaOperatore, nuovoCodiceOperatore, impostaOperatoreAttivo } from "./accesso/operatori";
export { accessoOperatore } from "./accesso/accessoOperatore";
export { driveAvviaCollegamento, driveRitorno, driveConfermaCollegamento, scollegaArchivio, collegaArchivioSimulato } from "./drive/collegamento";
export { apriCaricamento, registraFoto } from "./foto/caricamento";
export { caricamentoSimulato } from "./foto/caricamentoSimulato";
export { miniatura } from "./foto/miniatura";
export { puliziaNotturna } from "./manutenzione/pulizia";
