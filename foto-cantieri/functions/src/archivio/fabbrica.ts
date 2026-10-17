import { FieldValue } from "firebase-admin/firestore";
import type { Ditta, InfoArchivio } from "../../../shared/modello";
import { CHIAVE_CIFRATURA_ARCHIVIO, decifra } from "../cifratura";
import { db, errore } from "../comune";
import { configOAuth } from "../drive/config";
import type { Archivio } from "./Archivio";
import { ArchivioSimulato } from "./ArchivioSimulato";
import { GoogleDriveArchivio } from "./GoogleDriveArchivio";

/**
 * L'unico punto che sa quale archivio usa una ditta.
 * Le Functions che lo chiamano devono dichiarare i secret
 * CHIAVE_CIFRATURA_ARCHIVIO e GOOGLE_CLIENT_SECRET.
 */
export async function archivioDellaDitta(dittaId: string): Promise<{ archivio: Archivio; info: InfoArchivio }> {
  const ditta = (await db().doc(`ditte/${dittaId}`).get()).data() as Ditta | undefined;
  if (!ditta) throw errore("not-found", "Ditta non trovata.");
  const info = ditta.archivio;
  if (info.stato !== "collegato") {
    throw errore("failed-precondition", "Il titolare deve prima collegare Google Drive.");
  }

  switch (info.tipo) {
    case "simulato":
      return { archivio: new ArchivioSimulato(dittaId), info };
    case "googleDrive": {
      const cred = await db().doc(`credenzialiArchivio/${dittaId}`).get();
      if (!cred.exists) throw errore("failed-precondition", "Il titolare deve ricollegare Google Drive.");
      const refreshToken = decifra(cred.get("cifrato") as string, dittaId, CHIAVE_CIFRATURA_ARCHIVIO.value());
      return { archivio: new GoogleDriveArchivio(configOAuth(), refreshToken), info };
    }
    default:
      throw errore("failed-precondition", "Archivio non disponibile per questa ditta.");
  }
}

/** Segna l'archivio come da ricollegare (es. permesso revocato dal titolare su Google). */
export async function segnaArchivioInErrore(dittaId: string): Promise<void> {
  await db().doc(`ditte/${dittaId}`).update({
    "archivio.stato": "errore",
    aggiornataIl: FieldValue.serverTimestamp(),
  });
}
