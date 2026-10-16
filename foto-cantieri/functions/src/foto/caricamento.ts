import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { Commessa, Ditta } from "../../../shared/modello";
import { ArchivioScollegato } from "../archivio/Archivio";
import { archivioDellaDitta, segnaArchivioInErrore } from "../archivio/fabbrica";
import { CHIAVE_CIFRATURA_ARCHIVIO } from "../cifratura";
import { db, errore, idValido, richiediMembro, type Membro } from "../comune";
import { GOOGLE_CLIENT_SECRET, origineConsentita } from "../drive/config";
import { cartellaDestinazione } from "./cartelle";

export const DIMENSIONE_MASSIMA = 15 * 1024 * 1024;
const MIME = "image/jpeg";
const VALIDITA_CARICAMENTO_ORE = 24;

/** Dati di un caricamento aperto e non ancora registrato (raccolta riservata "caricamenti"). */
interface Caricamento {
  dittaId: string;
  uid: string;
  operatoreId: string | null;
  autore: string;
  commessaId: string;
  sottocartella: string;
  archivio: string;
  cartellaId: string;
  nomeFile: string;
  dimensione: number;
  larghezza: number;
  altezza: number;
  scattataIl: Timestamp;
  scadeIl: Timestamp;
}

function intero(valore: unknown, cosa: string, min: number, max: number): number {
  if (typeof valore !== "number" || !Number.isInteger(valore) || valore < min || valore > max) {
    throw errore("invalid-argument", `${cosa} non valido.`);
  }
  return valore;
}

/** Data di scatto dal telefono, se plausibile; altrimenti adesso. */
function dataScatto(valore: unknown): Timestamp {
  const ora = Date.now();
  if (typeof valore === "number" && valore > Date.UTC(2000, 0, 1) && valore < ora + 86_400_000) {
    return Timestamp.fromMillis(valore);
  }
  return Timestamp.fromMillis(ora);
}

/** Es. "2026-014_Prima_20261016-143005_k3x9.jpg" (ora italiana). */
export function nomeFileFoto(numeroCommessa: string, sottocartella: string, scattata: Date): string {
  const parti = Object.fromEntries(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(scattata).map((p) => [p.type, p.value]),
  );
  const data = `${parti.year}${parti.month}${parti.day}-${parti.hour}${parti.minute}${parti.second}`;
  const pulisci = (t: string) => t.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "x";
  return `${pulisci(numeroCommessa)}_${pulisci(sottocartella)}_${data}_${randomBytes(3).toString("hex")}.jpg`;
}

/** Errori dell'archivio tradotti per l'utente; se il permesso è stato revocato lo si segna. */
async function conArchivio<T>(dittaId: string, azione: () => Promise<T>): Promise<T> {
  try {
    return await azione();
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e instanceof ArchivioScollegato) {
      await segnaArchivioInErrore(dittaId);
      throw errore("failed-precondition", "Google Drive della ditta non è più collegato: avvisa il titolare.");
    }
    logger.error("Errore dell'archivio", { dittaId, errore: String(e) });
    throw errore("unavailable", "L'archivio non risponde. Riprova tra poco.");
  }
}

/**
 * Apre il caricamento di una foto. Riceve:
 *   { commessaId, sottocartella, dimensione, larghezza, altezza, scattataIl }
 * Restituisce { idCaricamento, urlCaricamento }: il telefono manda i byte (JPEG)
 * con una PUT direttamente all'archivio, poi chiama registraFoto.
 */
export const apriCaricamento = onCall(
  { secrets: [CHIAVE_CIFRATURA_ARCHIVIO, GOOGLE_CLIENT_SECRET] },
  async (req) => {
    const membro: Membro = await richiediMembro(req);
    const d = req.data ?? {};
    const commessaId = idValido(d.commessaId, "Commessa");
    const dimensione = intero(d.dimensione, "Dimensione della foto", 1, DIMENSIONE_MASSIMA);
    const larghezza = intero(d.larghezza, "Larghezza", 1, 20_000);
    const altezza = intero(d.altezza, "Altezza", 1, 20_000);
    const origine = req.rawRequest.headers.origin;
    if (!origineConsentita(origine)) throw errore("permission-denied", "Indirizzo dell'app non autorizzato.");

    const { dittaId } = membro;
    const [dittaDoc, commessaDoc] = await Promise.all([
      db().doc(`ditte/${dittaId}`).get(),
      db().doc(`ditte/${dittaId}/commesse/${commessaId}`).get(),
    ]);
    const ditta = dittaDoc.data() as Ditta;
    const commessa = commessaDoc.data() as Commessa | undefined;
    if (!commessa) throw errore("not-found", "Commessa non trovata.");
    if (!commessa.attiva) throw errore("failed-precondition", "La commessa è chiusa.");
    const sottocartella = d.sottocartella;
    if (typeof sottocartella !== "string" || !ditta.sottocartelle.includes(sottocartella)) {
      throw errore("invalid-argument", "Sottocartella non valida.");
    }

    const { archivio, info } = await archivioDellaDitta(dittaId);
    const scattataIl = dataScatto(d.scattataIl);
    const nomeFile = nomeFileFoto(commessa.numero, sottocartella, scattataIl.toDate());

    return conArchivio(dittaId, async () => {
      const cartellaId = await cartellaDestinazione(archivio, info, dittaId, commessaId, commessa, sottocartella);
      const { urlCaricamento } = await archivio.apriCaricamento({ cartellaId, nomeFile, mimeType: MIME, dimensione, origine });
      const rif = db().collection("caricamenti").doc();
      const voce: Caricamento = {
        dittaId, uid: req.auth!.uid, operatoreId: membro.operatoreId ?? null, autore: membro.autore,
        commessaId, sottocartella, archivio: archivio.tipo, cartellaId, nomeFile,
        dimensione, larghezza, altezza, scattataIl,
        scadeIl: Timestamp.fromMillis(Date.now() + VALIDITA_CARICAMENTO_ORE * 3_600_000),
      };
      await rif.create(voce);
      return { idCaricamento: rif.id, urlCaricamento };
    });
  },
);

/**
 * Dopo la PUT, il telefono registra la foto. Riceve: { idCaricamento, fileId }.
 * La Function controlla nell'archivio che il file esista davvero, nella cartella giusta
 * e con la dimensione attesa, poi scrive la voce nell'indice. Si può ripetere senza doppioni.
 */
export const registraFoto = onCall(
  { secrets: [CHIAVE_CIFRATURA_ARCHIVIO, GOOGLE_CLIENT_SECRET] },
  async (req) => {
    const membro = await richiediMembro(req);
    const idCaricamento = idValido(req.data?.idCaricamento, "Caricamento");
    const fileId = typeof req.data?.fileId === "string" ? req.data.fileId : "";
    if (!fileId || fileId.length > 300) throw errore("invalid-argument", "File non indicato.");

    const rifFoto = db().doc(`ditte/${membro.dittaId}/foto/${idCaricamento}`);
    const rifCaricamento = db().doc(`caricamenti/${idCaricamento}`);
    const [foto, caricamentoDoc] = await Promise.all([rifFoto.get(), rifCaricamento.get()]);
    if (foto.exists && foto.get("caricataDaUid") === req.auth!.uid) return { fotoId: idCaricamento };

    const c = caricamentoDoc.data() as Caricamento | undefined;
    if (!c || c.uid !== req.auth!.uid || c.dittaId !== membro.dittaId) {
      throw errore("not-found", "Caricamento non trovato.");
    }
    if (c.scadeIl.toMillis() < Date.now()) throw errore("deadline-exceeded", "Caricamento scaduto: rifai la foto.");

    const { archivio } = await archivioDellaDitta(membro.dittaId);
    const file = await conArchivio(membro.dittaId, () => archivio.infoFile(fileId));
    if (
      !file ||
      !file.cartelle.includes(c.cartellaId) ||
      file.nome !== c.nomeFile ||
      file.dimensione !== c.dimensione ||
      file.mimeType !== MIME
    ) {
      logger.warn("File non corrispondente al caricamento", { idCaricamento, fileId, file });
      throw errore("failed-precondition", "La foto non risulta caricata correttamente. Riprova.");
    }

    await db().runTransaction(async (tx) => {
      tx.create(rifFoto, {
        commessaId: c.commessaId,
        sottocartella: c.sottocartella,
        archivio: c.archivio,
        fileId: file.id,
        cartellaId: c.cartellaId,
        nomeFile: c.nomeFile,
        mimeType: MIME,
        dimensione: c.dimensione,
        larghezza: c.larghezza,
        altezza: c.altezza,
        caricataDaUid: c.uid,
        ...(c.operatoreId ? { operatoreId: c.operatoreId } : {}),
        autore: c.autore,
        scattataIl: c.scattataIl,
        caricataIl: FieldValue.serverTimestamp(),
      });
      tx.delete(rifCaricamento);
    });
    return { fotoId: idCaricamento };
  },
);
