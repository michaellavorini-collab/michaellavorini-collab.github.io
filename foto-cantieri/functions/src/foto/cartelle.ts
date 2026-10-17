import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Commessa, InfoArchivio } from "../../../shared/modello";
import { NOME_CARTELLA_RADICE, type Archivio } from "../archivio/Archivio";
import { db } from "../comune";

/** Nome della cartella di una commessa nell'archivio, es. "2026-014 - Sostituzione caldaia". */
export function nomeCartellaCommessa(c: Pick<Commessa, "numero" | "descrizione">): string {
  return c.descrizione.trim() ? `${c.numero} - ${c.descrizione}` : c.numero;
}

/**
 * Cartella di destinazione: Foto Cantieri / <commessa> / <sottocartella>.
 * Gli id si tengono in una cache (raccolta riservata) per non cercarli su Drive a ogni foto;
 * se la cartella è stata cancellata dall'archivio, si ricrea.
 */
export async function cartellaDestinazione(
  archivio: Archivio,
  info: InfoArchivio,
  dittaId: string,
  commessaId: string,
  commessa: Commessa,
  sottocartella: string,
): Promise<string> {
  const chiave = createHash("sha256")
    .update([dittaId, archivio.tipo, info.cartellaRadiceId, commessaId, sottocartella].join("|"))
    .digest("hex");
  const rifCache = db().doc(`cacheCartelle/${chiave}`);
  const inCache = (await rifCache.get()).get("cartellaId") as string | undefined;
  if (inCache && (await archivio.cartellaEsiste(inCache))) return inCache;

  let radice = info.cartellaRadiceId;
  if (!radice || !(await archivio.cartellaEsiste(radice))) {
    radice = await archivio.assicuraCartella(NOME_CARTELLA_RADICE);
    await db().doc(`ditte/${dittaId}`).update({
      "archivio.cartellaRadiceId": radice,
      aggiornataIl: FieldValue.serverTimestamp(),
    });
  }
  const cartellaCommessa = await archivio.assicuraCartella(nomeCartellaCommessa(commessa), radice);
  const cartella = await archivio.assicuraCartella(sottocartella, cartellaCommessa);
  await rifCache.set({ cartellaId: cartella, dittaId, aggiornataIl: FieldValue.serverTimestamp() });
  return cartella;
}
