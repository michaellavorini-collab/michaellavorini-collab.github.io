/** OAuth di Google per Drive: solo il permesso drive.file (l'app vede solo i file che crea). */

export const SCOPE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";

export const URL_GOOGLE = {
  autorizzazione: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoca: "https://oauth2.googleapis.com/revoke",
  drive: "https://www.googleapis.com/drive/v3",
  upload: "https://www.googleapis.com/upload/drive/v3",
};

export interface ConfigOAuth {
  clientId: string;
  clientSecret: string;
  urlRitorno: string;
}

export function urlAutorizzazione(
  config: Pick<ConfigOAuth, "clientId" | "urlRitorno">,
  stato: string,
  emailSuggerita?: string,
): string {
  const p = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.urlRitorno,
    response_type: "code",
    scope: SCOPE_DRIVE_FILE,
    // "offline" + "consent": Google restituisce un refresh token, che serve
    // per caricare le foto anche quando il titolare non è collegato.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: stato,
  });
  if (emailSuggerita) p.set("login_hint", emailSuggerita);
  return `${URL_GOOGLE.autorizzazione}?${p}`;
}

export class ErroreOAuth extends Error {
  constructor(public readonly motivo: "rifiutato" | "permesso-mancante" | "senza-refresh" | "google", messaggio: string) {
    super(messaggio);
    this.name = "ErroreOAuth";
  }
}

/** Scambia il codice ricevuto da Google con il refresh token. */
export async function scambiaCodice(config: ConfigOAuth, codice: string): Promise<{ refreshToken: string; accessToken: string; scadeIl: number }> {
  const r = await fetch(URL_GOOGLE.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: codice,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.urlRitorno,
      grant_type: "authorization_code",
    }),
  });
  const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new ErroreOAuth("google", `Scambio del codice non riuscito (${r.status} ${corpo.error ?? ""}).`);

  const scope = String(corpo.scope ?? "").split(" ");
  // Con il consenso granulare l'utente può togliere la spunta su Drive.
  if (!scope.includes(SCOPE_DRIVE_FILE)) {
    throw new ErroreOAuth("permesso-mancante", "Non è stato concesso il permesso per Google Drive.");
  }
  if (typeof corpo.refresh_token !== "string" || !corpo.refresh_token) {
    throw new ErroreOAuth("senza-refresh", "Google non ha restituito il token di rinnovo.");
  }
  return {
    refreshToken: corpo.refresh_token,
    accessToken: String(corpo.access_token),
    scadeIl: Date.now() + Number(corpo.expires_in ?? 3600) * 1000,
  };
}

/** Nuovo access token dal refresh token. Restituisce null se il permesso è stato revocato. */
export async function rinnovaAccesso(
  config: Pick<ConfigOAuth, "clientId" | "clientSecret">,
  refreshToken: string,
): Promise<{ accessToken: string; scadeIl: number } | null> {
  const r = await fetch(URL_GOOGLE.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.status === 400 && corpo.error === "invalid_grant") return null;
  if (!r.ok) throw new Error(`Rinnovo del token Google non riuscito (${r.status}).`);
  return { accessToken: String(corpo.access_token), scadeIl: Date.now() + Number(corpo.expires_in ?? 3600) * 1000 };
}

/** Revoca il permesso dal lato Google (scollegamento). Gli errori si ignorano. */
export async function revocaToken(token: string): Promise<void> {
  await fetch(`${URL_GOOGLE.revoca}?${new URLSearchParams({ token })}`, { method: "POST" }).catch(() => undefined);
}
