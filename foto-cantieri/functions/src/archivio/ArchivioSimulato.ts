import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../comune";
import { nomeCartellaSicuro, type Archivio, type Immagine, type InfoFile, type RichiestaCaricamento } from "./Archivio";

/** Vero solo quando le Functions girano nell'emulatore locale. */
export const inEmulatore = () => process.env.FUNCTIONS_EMULATOR === "true";

/** Cartella del computer di sviluppo che fa da "Drive" finto (fuori da git). */
export function cartellaBaseSimulata(): string {
  return resolve(process.env.ARCHIVIO_SIMULATO_DIR ?? join(process.cwd(), "..", ".archivio-simulato"));
}

/** Sessione di caricamento simulata (raccolta riservata alle Functions). */
export interface SessioneSimulata {
  dittaId: string;
  cartellaId: string;
  nomeFile: string;
  mimeType: string;
  dimensione: number;
  scadeIl: Timestamp;
}

/**
 * Archivio finto per lo sviluppo: le "cartelle" sono cartelle sul disco del computer
 * di sviluppo, una per ditta. Esiste solo nell'emulatore: in produzione non si può creare,
 * così nessuna foto può finire sui nostri server.
 * Gli id di cartelle e file sono i percorsi relativi codificati in base64url.
 */
export class ArchivioSimulato implements Archivio {
  readonly tipo = "simulato" as const;
  private readonly radice: string;

  constructor(private readonly dittaId: string) {
    if (!inEmulatore()) throw new Error("L'archivio simulato esiste solo con gli emulatori.");
    this.radice = join(cartellaBaseSimulata(), nomeCartellaSicuro(dittaId));
  }

  /** Percorso sul disco dall'id, senza mai uscire dalla cartella della ditta. */
  percorso(id?: string): string {
    const relativo = id ? Buffer.from(id, "base64url").toString("utf8") : "";
    const p = resolve(this.radice, relativo);
    if (p !== this.radice && !p.startsWith(this.radice + sep)) throw new Error("Percorso non valido.");
    return p;
  }

  id(percorso: string): string {
    return Buffer.from(percorso.slice(this.radice.length + 1), "utf8").toString("base64url");
  }

  async account(): Promise<string> {
    return "archivio di prova (locale)";
  }

  async assicuraCartella(nome: string, padreId?: string): Promise<string> {
    const p = join(this.percorso(padreId), nomeCartellaSicuro(nome));
    await mkdir(p, { recursive: true });
    return this.id(p);
  }

  async cartellaEsiste(cartellaId: string): Promise<boolean> {
    try {
      return (await stat(this.percorso(cartellaId))).isDirectory();
    } catch {
      return false;
    }
  }

  /** Come Drive: un indirizzo monouso a cui il telefono manda i byte con una PUT. */
  async apriCaricamento(r: RichiestaCaricamento): Promise<{ urlCaricamento: string }> {
    const sessione = randomBytes(24).toString("base64url");
    const voce: SessioneSimulata = {
      dittaId: this.dittaId,
      cartellaId: r.cartellaId,
      nomeFile: nomeCartellaSicuro(r.nomeFile),
      mimeType: r.mimeType,
      dimensione: r.dimensione,
      scadeIl: Timestamp.fromMillis(Date.now() + 60 * 60_000),
    };
    await db().doc(`sessioniSimulate/${sessione}`).create(voce);
    // L'emulatore delle Functions sta sullo stesso host da cui è aperta l'app (anche dal telefono).
    const host = new URL(r.origine).hostname;
    const progetto = process.env.GCLOUD_PROJECT ?? "demo-foto-cantieri";
    return { urlCaricamento: `http://${host}:5001/${progetto}/europe-west1/caricamentoSimulato?sessione=${sessione}` };
  }

  /** In sviluppo si restituisce la foto intera (già ridotta a ~1600 px dal telefono). */
  async miniatura(fileId: string): Promise<Immagine | null> {
    const info = await this.infoFile(fileId);
    if (!info) return null;
    return { contenuto: await readFile(this.percorso(fileId)), mimeType: info.mimeType };
  }

  async infoFile(fileId: string): Promise<InfoFile | null> {
    try {
      const p = this.percorso(fileId);
      const s = await stat(p);
      if (!s.isFile()) return null;
      return {
        id: fileId,
        nome: basename(p),
        mimeType: p.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "application/octet-stream",
        dimensione: s.size,
        cartelle: [this.id(dirname(p))],
      };
    } catch {
      return null;
    }
  }
}
