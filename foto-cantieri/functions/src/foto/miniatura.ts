import { logger } from "firebase-functions/v2";
import { HttpsError, onRequest } from "firebase-functions/v2/https";
import type { Foto } from "../../../shared/modello";
import { ArchivioScollegato } from "../archivio/Archivio";
import { archivioDellaDitta, segnaArchivioInErrore } from "../archivio/fabbrica";
import { CHIAVE_CIFRATURA_ARCHIVIO } from "../cifratura";
import { auth, db, membroDaToken } from "../comune";
import { GOOGLE_CLIENT_SECRET, origineConsentita } from "../drive/config";

/** Misure disponibili: miniatura per la galleria, grande per la vista a schermo intero. */
export const LATI = { miniatura: 400, grande: 1600 } as const;

const STATI: Record<string, number> = {
  unauthenticated: 401, "permission-denied": 403, "not-found": 404, "invalid-argument": 400, "failed-precondition": 409,
};

/**
 * GET /miniatura?foto=<fotoId>[&misura=grande], con "Authorization: Bearer <token Firebase>".
 * Legge l'immagine dall'archivio della ditta e la passa al telefono così com'è:
 * non viene salvata da nessuna parte (né su disco né nel database).
 * La ditta si prende dal token, mai dalla richiesta: si vedono solo le proprie foto.
 */
export const miniatura = onRequest(
  { secrets: [CHIAVE_CIFRATURA_ARCHIVIO, GOOGLE_CLIENT_SECRET] },
  async (req, res) => {
    // CORS solo per gli indirizzi dell'app.
    const origine = req.headers.origin;
    if (origine) {
      if (!origineConsentita(origine)) {
        res.status(403).send("Indirizzo non autorizzato");
        return;
      }
      res.set("Access-Control-Allow-Origin", origine);
      res.set("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET");
      res.set("Access-Control-Allow-Headers", "Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).end();
      return;
    }
    if (req.method !== "GET") {
      res.status(405).send("Usa GET");
      return;
    }

    let dittaId = "";
    try {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (!bearer) throw new HttpsError("unauthenticated", "Accesso richiesto.");
      // checkRevoked: le sessioni chiuse (operatore disattivato o nuovo codice) non valgono più.
      const token = await auth().verifyIdToken(bearer, true).catch(() => {
        throw new HttpsError("unauthenticated", "Accesso scaduto: rientra.");
      });
      const membro = await membroDaToken(token as unknown as Record<string, unknown>);
      dittaId = membro.dittaId;

      const fotoId = typeof req.query.foto === "string" ? req.query.foto : "";
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(fotoId)) throw new HttpsError("invalid-argument", "Foto non valida.");
      const lato = req.query.misura === "grande" ? LATI.grande : LATI.miniatura;

      const foto = (await db().doc(`ditte/${dittaId}/foto/${fotoId}`).get()).data() as Foto | undefined;
      if (!foto) throw new HttpsError("not-found", "Foto non trovata.");

      const { archivio } = await archivioDellaDitta(dittaId);
      if (archivio.tipo !== foto.archivio) throw new HttpsError("not-found", "La foto è in un archivio non più collegato.");
      const immagine = await archivio.miniatura(foto.fileId, lato);
      if (!immagine) throw new HttpsError("not-found", "La foto non è più nell'archivio.");

      // Cache solo nel browser di chi l'ha chiesta (private), mai su server intermedi.
      res.set("Cache-Control", "private, max-age=3600");
      res.set("Content-Type", immagine.mimeType);
      res.status(200).send(immagine.contenuto);
    } catch (e) {
      if (e instanceof HttpsError) {
        res.status(STATI[e.code] ?? 500).send(e.message);
        return;
      }
      if (e instanceof ArchivioScollegato && dittaId) {
        await segnaArchivioInErrore(dittaId);
        res.status(409).send("Google Drive della ditta non è più collegato.");
        return;
      }
      logger.error("Miniatura non riuscita", { dittaId, errore: String(e) });
      res.status(502).send("L'archivio non risponde.");
    }
  },
);
