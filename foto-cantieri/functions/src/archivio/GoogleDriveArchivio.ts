import { ArchivioScollegato, nomeCartellaSicuro, type Archivio, type InfoFile, type RichiestaCaricamento } from "./Archivio";
import { rinnovaAccesso, URL_GOOGLE, type ConfigOAuth } from "../drive/oauth";

const TIPO_CARTELLA = "application/vnd.google-apps.folder";

/** Testo dentro apici singoli nelle ricerche di Drive. */
export function testoPerRicerca(t: string): string {
  return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Archivio sul Google Drive della ditta, con il solo permesso drive.file.
 * Usa il refresh token (decifrato solo in memoria) per ottenere access token brevi.
 */
export class GoogleDriveArchivio implements Archivio {
  readonly tipo = "googleDrive" as const;
  private accesso: { accessToken: string; scadeIl: number } | null;

  constructor(
    private readonly config: Pick<ConfigOAuth, "clientId" | "clientSecret">,
    private readonly refreshToken: string,
    accessoIniziale?: { accessToken: string; scadeIl: number },
  ) {
    this.accesso = accessoIniziale ?? null;
  }

  private async token(): Promise<string> {
    if (!this.accesso || this.accesso.scadeIl - 60_000 < Date.now()) {
      this.accesso = await rinnovaAccesso(this.config, this.refreshToken);
      if (!this.accesso) throw new ArchivioScollegato("Il permesso su Google Drive è stato revocato.");
    }
    return this.accesso.accessToken;
  }

  private async chiama<T>(percorso: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${URL_GOOGLE.drive}${percorso}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.token()}`, ...(init.headers ?? {}) },
    });
    if (r.status === 401) throw new ArchivioScollegato();
    if (!r.ok) throw new Error(`Google Drive ha risposto ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return (await r.json()) as T;
  }

  async account(): Promise<string> {
    const { user } = await this.chiama<{ user?: { emailAddress?: string; displayName?: string } }>(
      "/about?fields=user(emailAddress,displayName)",
    );
    return user?.emailAddress ?? user?.displayName ?? "";
  }

  async assicuraCartella(nome: string, padreId?: string): Promise<string> {
    const n = nomeCartellaSicuro(nome);
    const condizioni = [
      `name = '${testoPerRicerca(n)}'`,
      `mimeType = '${TIPO_CARTELLA}'`,
      "trashed = false",
      `'${testoPerRicerca(padreId ?? "root")}' in parents`,
    ];
    const q = new URLSearchParams({ q: condizioni.join(" and "), fields: "files(id)", pageSize: "1", spaces: "drive" });
    const trovate = await this.chiama<{ files: { id: string }[] }>(`/files?${q}`);
    if (trovate.files.length) return trovate.files[0].id;

    const creata = await this.chiama<{ id: string }>("/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n, mimeType: TIPO_CARTELLA, ...(padreId ? { parents: [padreId] } : {}) }),
    });
    return creata.id;
  }

  async apriCaricamento(r: RichiestaCaricamento): Promise<{ urlCaricamento: string }> {
    const q = new URLSearchParams({ uploadType: "resumable", fields: "id" });
    const risposta = await fetch(`${URL_GOOGLE.upload}/files?${q}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": r.mimeType,
        "X-Upload-Content-Length": String(r.dimensione),
        // Con l'Origin dell'app, Drive accetta poi la PUT diretta dal browser (CORS).
        Origin: r.origine,
      },
      body: JSON.stringify({ name: r.nomeFile, parents: [r.cartellaId], mimeType: r.mimeType }),
    });
    if (risposta.status === 401) throw new ArchivioScollegato();
    const url = risposta.headers.get("location");
    if (!risposta.ok || !url) {
      throw new Error(`Drive non ha aperto il caricamento (${risposta.status}): ${(await risposta.text()).slice(0, 300)}`);
    }
    return { urlCaricamento: url };
  }

  async infoFile(fileId: string): Promise<InfoFile | null> {
    try {
      const f = await this.chiama<{ id: string; name: string; mimeType: string; size?: string; parents?: string[]; trashed?: boolean }>(
        `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents,trashed`,
      );
      if (f.trashed) return null;
      return { id: f.id, nome: f.name, mimeType: f.mimeType, dimensione: Number(f.size ?? 0), cartelle: f.parents ?? [] };
    } catch (e) {
      if (e instanceof ArchivioScollegato) throw e;
      return null;
    }
  }

  async cartellaEsiste(cartellaId: string): Promise<boolean> {
    try {
      const f = await this.chiama<{ trashed?: boolean; mimeType?: string }>(
        `/files/${encodeURIComponent(cartellaId)}?fields=trashed,mimeType`,
      );
      return !f.trashed && f.mimeType === TIPO_CARTELLA;
    } catch (e) {
      if (e instanceof ArchivioScollegato) throw e;
      return false;
    }
  }
}
