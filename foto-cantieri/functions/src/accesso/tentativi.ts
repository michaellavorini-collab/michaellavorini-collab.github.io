import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db, errore } from "../comune";

/** Dopo quanti errori si blocca, e per quanto. */
export const SOGLIE = {
  /** Stesso dispositivo/rete sulla stessa ditta. */
  perIndirizzo: 5,
  /** Tutta la ditta, da qualunque indirizzo (protegge da attacchi distribuiti). */
  perDitta: 50,
  bloccoMinuti: 15,
  /** Gli errori più vecchi di così non contano più. */
  finestraMinuti: 15,
};

/** Chiavi dei contatori. L'indirizzo IP non si salva in chiaro, solo un'impronta. */
export function chiaviTentativi(codiceDitta: string, ip: string): { chiave: string; soglia: number }[] {
  const ipImpronta = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return [
    { chiave: `ip_${ipImpronta}_${codiceDitta}`, soglia: SOGLIE.perIndirizzo },
    { chiave: `ditta_${codiceDitta}`, soglia: SOGLIE.perDitta },
  ];
}

export async function controllaBlocco(chiavi: { chiave: string }[]): Promise<void> {
  const ora = Date.now();
  const docs = await db().getAll(...chiavi.map((c) => db().doc(`tentativiAccesso/${c.chiave}`)));
  for (const d of docs) {
    const fino = d.get("bloccatoFinoA") as Timestamp | undefined;
    if (fino && fino.toMillis() > ora) {
      const minuti = Math.ceil((fino.toMillis() - ora) / 60000);
      throw errore(
        "resource-exhausted",
        `Troppi tentativi sbagliati. Riprova tra ${minuti} ${minuti === 1 ? "minuto" : "minuti"}.`,
      );
    }
  }
}

export async function registraErrore(chiavi: { chiave: string; soglia: number }[]): Promise<void> {
  const ora = Timestamp.now();
  await db().runTransaction(async (tx) => {
    const rifs = chiavi.map((c) => db().doc(`tentativiAccesso/${c.chiave}`));
    const docs = await tx.getAll(...rifs);
    docs.forEach((d, i) => {
      const ultimo = d.get("ultimoIl") as Timestamp | undefined;
      const recente = ultimo && ora.toMillis() - ultimo.toMillis() < SOGLIE.finestraMinuti * 60000;
      const falliti = (recente ? ((d.get("falliti") as number) ?? 0) : 0) + 1;
      if (falliti >= chiavi[i].soglia) {
        const fino = Timestamp.fromMillis(ora.toMillis() + SOGLIE.bloccoMinuti * 60000);
        tx.set(rifs[i], { falliti: 0, bloccatoFinoA: fino, ultimoIl: ora });
      } else {
        tx.set(rifs[i], { falliti, ultimoIl: ora });
      }
    });
  });
}

/** Accesso riuscito: azzera il contatore del dispositivo (quello della ditta scade da solo). */
export async function azzeraTentativi(chiavi: { chiave: string }[]): Promise<void> {
  await db().doc(`tentativiAccesso/${chiavi[0].chiave}`).delete();
}
