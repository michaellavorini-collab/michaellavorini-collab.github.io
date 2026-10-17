import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { defineSecret } from "firebase-functions/params";

/**
 * Chiave (32 byte in base64) con cui si cifrano i token di accesso a Drive/OneDrive.
 * Sta nei Secret di Firebase; in locale in functions/.secret.local.
 */
export const CHIAVE_CIFRATURA_ARCHIVIO = defineSecret("CHIAVE_CIFRATURA_ARCHIVIO");

const VERSIONE = "v1";

function chiave(base64: string): Buffer {
  const k = Buffer.from(base64, "base64");
  if (k.length !== 32) throw new Error("CHIAVE_CIFRATURA_ARCHIVIO deve essere di 32 byte in base64.");
  return k;
}

/**
 * Cifra con AES-256-GCM. Il "contesto" (es. il dittaId) viene legato al testo cifrato:
 * le credenziali di una ditta non si possono decifrare spacciandole per quelle di un'altra.
 * Formato: "v1:" + base64(iv 12 byte | tag 16 byte | dati).
 */
export function cifra(testo: string, contesto: string, chiaveBase64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chiave(chiaveBase64), iv);
  c.setAAD(Buffer.from(contesto, "utf8"));
  const dati = Buffer.concat([c.update(testo, "utf8"), c.final()]);
  return `${VERSIONE}:${Buffer.concat([iv, c.getAuthTag(), dati]).toString("base64")}`;
}

/** Decifra; lancia un errore se il dato è stato alterato o il contesto non coincide. */
export function decifra(cifrato: string, contesto: string, chiaveBase64: string): string {
  const [versione, corpo] = cifrato.split(":");
  if (versione !== VERSIONE || !corpo) throw new Error("Formato cifrato sconosciuto.");
  const buf = Buffer.from(corpo, "base64");
  const d = createDecipheriv("aes-256-gcm", chiave(chiaveBase64), buf.subarray(0, 12));
  d.setAAD(Buffer.from(contesto, "utf8"));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
