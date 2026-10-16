import { mkdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { nomeCartellaSicuro, type Archivio } from "./Archivio";

/** Vero solo quando le Functions girano nell'emulatore locale. */
export const inEmulatore = () => process.env.FUNCTIONS_EMULATOR === "true";

/** Cartella del computer di sviluppo che fa da "Drive" finto (fuori da git). */
export function cartellaBaseSimulata(): string {
  return resolve(process.env.ARCHIVIO_SIMULATO_DIR ?? join(process.cwd(), "..", ".archivio-simulato"));
}

/**
 * Archivio finto per lo sviluppo: le "cartelle" sono cartelle sul disco del computer
 * di sviluppo, una per ditta. Esiste solo nell'emulatore: in produzione non si può creare,
 * così nessuna foto può finire sui nostri server.
 * Gli id delle cartelle sono i percorsi relativi codificati in base64url.
 */
export class ArchivioSimulato implements Archivio {
  readonly tipo = "simulato" as const;
  private readonly radice: string;

  constructor(dittaId: string) {
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

  private id(percorso: string): string {
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
}
