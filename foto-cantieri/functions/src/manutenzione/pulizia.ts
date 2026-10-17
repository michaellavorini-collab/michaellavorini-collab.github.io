import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../comune";

/** Dopo quanto un contatore di tentativi senza nuovi errori si può cancellare. */
const CONSERVA_TENTATIVI_ORE = 24;

/** Cosa si cancella: documenti tecnici temporanei, mai dati della ditta né l'indice foto. */
const SCADUTI = [
  // Caricamenti aperti e mai registrati (il telefono non ha finito).
  { raccolta: "caricamenti", campo: "scadeIl" },
  // Collegamenti a Google Drive iniziati e non completati.
  { raccolta: "collegamentiInCorso", campo: "scadeIl" },
  // Sessioni dell'archivio di prova (solo sviluppo).
  { raccolta: "sessioniSimulate", campo: "scadeIl" },
] as const;

async function cancellaPrimaDi(firestore: Firestore, raccolta: string, campo: string, limite: Timestamp): Promise<number> {
  let totale = 0;
  for (;;) {
    const pagina = await firestore.collection(raccolta).where(campo, "<", limite).limit(400).get();
    if (pagina.empty) return totale;
    const batch = firestore.batch();
    pagina.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    totale += pagina.size;
  }
}

/** Esegue la pulizia e restituisce quanti documenti ha cancellato per raccolta. */
export async function eseguiPulizia(firestore: Firestore = db(), ora = Date.now()): Promise<Record<string, number>> {
  const adesso = Timestamp.fromMillis(ora);
  const esito: Record<string, number> = {};
  for (const { raccolta, campo } of SCADUTI) {
    esito[raccolta] = await cancellaPrimaDi(firestore, raccolta, campo, adesso);
  }
  esito.tentativiAccesso = await cancellaPrimaDi(
    firestore,
    "tentativiAccesso",
    "ultimoIl",
    Timestamp.fromMillis(ora - CONSERVA_TENTATIVI_ORE * 3_600_000),
  );
  return esito;
}

/**
 * Ogni notte. Un caricamento scaduto può aver lasciato una foto nel Drive della ditta
 * senza voce nell'indice: resta lì (è della ditta), semplicemente non compare in galleria.
 */
export const puliziaNotturna = onSchedule(
  { schedule: "17 3 * * *", timeZone: "Europe/Rome", retryCount: 1 },
  async () => {
    const esito = await eseguiPulizia();
    logger.info("Pulizia notturna completata", esito);
  },
);
