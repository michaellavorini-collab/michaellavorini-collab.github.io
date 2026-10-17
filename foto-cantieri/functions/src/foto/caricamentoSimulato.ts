import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { onRequest } from "firebase-functions/v2/https";
import { ArchivioSimulato, inEmulatore, type SessioneSimulata } from "../archivio/ArchivioSimulato";
import { db } from "../comune";

/**
 * Solo con gli emulatori: fa la parte di Drive nel caricamento "resumable".
 * Riceve la PUT dei byte dal telefono e scrive il file nella cartella simulata.
 */
export const caricamentoSimulato = onRequest({ cors: true }, async (req, res) => {
  if (!inEmulatore()) {
    res.status(404).send("Non disponibile");
    return;
  }
  if (req.method !== "PUT") {
    res.status(405).send("Usa PUT");
    return;
  }
  const sessione = typeof req.query.sessione === "string" ? req.query.sessione : "";
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(sessione)) {
    res.status(404).send("Sessione non trovata");
    return;
  }
  const rif = db().doc(`sessioniSimulate/${sessione}`);
  const voce = (await rif.get()).data() as SessioneSimulata | undefined;
  if (!voce || voce.scadeIl.toMillis() < Date.now()) {
    res.status(404).send("Sessione non trovata o scaduta");
    return;
  }
  const corpo = req.rawBody ?? Buffer.alloc(0);
  // Come Drive: la dimensione deve essere quella dichiarata all'apertura.
  if (corpo.length !== voce.dimensione) {
    res.status(400).send(`Dimensione errata: attesi ${voce.dimensione} byte, arrivati ${corpo.length}`);
    return;
  }
  const archivio = new ArchivioSimulato(voce.dittaId);
  const percorso = join(archivio.percorso(voce.cartellaId), voce.nomeFile);
  await writeFile(percorso, corpo, { flag: "wx" });
  await rif.delete();
  res.status(200).json({ id: archivio.id(percorso) });
});
