import type { TipoArchivio } from "../../../shared/modello";

/**
 * L'archivio della ditta (Google Drive, OneDrive, o quello simulato in locale).
 * Il resto dell'app usa solo questa interfaccia e non sa quale implementazione c'è sotto.
 * Le foto stanno nell'archivio; nel nostro database finiscono solo gli id.
 *
 * (Ai passi 6 e 7 si aggiungono caricamento, verifica dei file e miniature.)
 */
export interface Archivio {
  readonly tipo: TipoArchivio;

  /** Account collegato, da mostrare al titolare (es. email Google). */
  account(): Promise<string>;

  /**
   * Restituisce l'id della cartella con quel nome dentro "padreId"
   * (o nella radice dell'archivio se manca), creandola se non esiste.
   */
  assicuraCartella(nome: string, padreId?: string): Promise<string>;

  /** Vero se la cartella esiste ancora e non è nel cestino. */
  cartellaEsiste(cartellaId: string): Promise<boolean>;
}

/** L'archivio non è più raggiungibile (permesso revocato, token scaduto): va ricollegato. */
export class ArchivioScollegato extends Error {
  constructor(messaggio = "L'archivio della ditta non è più collegato.") {
    super(messaggio);
    this.name = "ArchivioScollegato";
  }
}

export const NOME_CARTELLA_RADICE = "Foto Cantieri";

/** Nome di cartella sicuro: niente barre, caratteri di controllo o nomi speciali. */
export function nomeCartellaSicuro(nome: string): string {
  const pulito = nome
    .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return pulito === "" || pulito === "." || pulito === ".." ? "Senza nome" : pulito;
}
