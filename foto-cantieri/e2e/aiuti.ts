/** Strumenti comuni alle prove end-to-end. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const PROGETTO = 'demo-foto-cantieri'
export const CARTELLA_FOTO = join(import.meta.dirname, 'foto')
export const ARCHIVIO_SIMULATO = join(import.meta.dirname, '..', '.archivio-simulato')

/** Database e utenti degli emulatori vuoti all'inizio di ogni prova. */
export async function svuotaEmulatori() {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROGETTO}/accounts`, { method: 'DELETE' })
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROGETTO}/databases/(default)/documents`, { method: 'DELETE' })
}

/** Un "telefono" nuovo: contesto separato (come un altro dispositivo), conferme accettate. */
export async function nuovoTelefono(browser: Browser): Promise<{ contesto: BrowserContext; pagina: Page }> {
  const contesto = await browser.newContext()
  return { contesto, pagina: await nuovaPagina(contesto) }
}

export async function nuovaPagina(contesto: BrowserContext): Promise<Page> {
  const pagina = await contesto.newPage()
  pagina.on('dialog', (d) => void d.accept())
  return pagina
}

/**
 * Accesso del titolare con un account Google di prova.
 * La finestra di Google dell'emulatore carica script da apis.google.com, che in alcuni ambienti
 * è bloccato: si entra quindi con una credenziale Google finta (l'emulatore la accetta),
 * usando lo stesso modulo Firebase dell'app.
 */
export async function entraComeTitolare(pagina: Page, email: string) {
  await pagina.goto('/')
  await expect(pagina.getByText('Sei il titolare?')).toBeVisible()
  await pagina.evaluate(async (email) => {
    const sorgente = await (await fetch('/src/firebase.ts')).text()
    const urlAuth = /from\s+"([^"]*firebase_auth[^"]*)"/.exec(sorgente)?.[1]
    if (!urlAuth) throw new Error('Modulo firebase/auth non trovato in /src/firebase.ts')
    const { auth } = await import(/* @vite-ignore */ '/src/firebase.ts')
    const { signInWithCredential, GoogleAuthProvider } = await import(/* @vite-ignore */ urlAuth)
    const token = JSON.stringify({ sub: `google-${email}`, email, email_verified: true })
    await signInWithCredential(auth, GoogleAuthProvider.credential(token))
  }, email)
}

/** Titolare nuovo con la sua ditta: restituisce il codice ditta. */
export async function creaDitta(pagina: Page, email: string, nome: string): Promise<string> {
  await entraComeTitolare(pagina, email)
  await pagina.getByLabel('Nome della ditta').fill(nome)
  await pagina.getByRole('button', { name: 'Crea la ditta' }).click()
  const codice = pagina.locator('.codice-grande')
  await expect(codice).toHaveText(/^[A-Z0-9]{6}$/)
  return (await codice.textContent())!.trim()
}

export async function collegaArchivioDiProva(pagina: Page) {
  await pagina.getByRole('button', { name: 'Usa archivio di prova' }).click()
  await expect(pagina.getByText('archivio di prova (locale)')).toBeVisible()
}

/** Crea un operatore dalla scheda Operatori: restituisce il codice personale (8 cifre). */
export async function creaOperatore(pagina: Page, nome: string): Promise<string> {
  await pagina.getByRole('tab', { name: 'Operatori' }).click()
  await pagina.getByLabel('Nome').fill(nome)
  await pagina.getByRole('button', { name: 'Aggiungi operatore' }).click()
  const codice = pagina.locator('.evidenza .codice-grande')
  await expect(codice).toHaveText(/^\d{4} \d{4}$/)
  const cifre = (await codice.textContent())!.replace(/\s/g, '')
  await pagina.getByRole('button', { name: 'Fatto' }).click()
  return cifre
}

export async function creaCommessa(pagina: Page, numero: string, descrizione: string, cliente = '') {
  await pagina.getByRole('tab', { name: 'Commesse' }).click()
  await pagina.getByLabel('Numero').fill(numero)
  await pagina.getByLabel('Descrizione').fill(descrizione)
  await pagina.getByLabel('Cliente').fill(cliente)
  await pagina.getByRole('button', { name: 'Aggiungi commessa' }).click()
  await expect(pagina.getByText(descrizione)).toBeVisible()
}

export async function entraComeOperatore(pagina: Page, codiceDitta: string, codicePersonale: string) {
  await pagina.goto('/')
  await pagina.getByLabel('Codice ditta').fill(codiceDitta)
  await pagina.getByLabel('Codice personale').fill(codicePersonale)
  await pagina.getByRole('button', { name: 'Entra', exact: true }).click()
}

/** Ditta pronta: archivio di prova, un operatore, una commessa. */
export async function dittaPronta(browser: Browser) {
  const titolare = await nuovoTelefono(browser)
  const codiceDitta = await creaDitta(titolare.pagina, 'titolare@rossi.it', 'Termoidraulica Rossi')
  await collegaArchivioDiProva(titolare.pagina)
  const codiceMario = await creaOperatore(titolare.pagina, 'Mario')
  await creaCommessa(titolare.pagina, '2026-014', 'Sostituzione caldaia', 'Bianchi Anna')
  return { titolare, codiceDitta, codiceMario }
}

/** File .jpg dell'archivio di prova modificati dopo un certo momento. */
export function fotoNellArchivio(dopo: number): string[] {
  const trovate: string[] = []
  const visita = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      const s = statSync(p)
      if (s.isDirectory()) visita(p)
      else if (p.endsWith('.jpg') && s.mtimeMs >= dopo) trovate.push(p)
    }
  }
  try {
    visita(ARCHIVIO_SIMULATO)
  } catch {
    // archivio non ancora creato
  }
  return trovate
}

/** Dimensioni di un JPEG e presenza di dati EXIF, leggendo i segmenti del file. */
export function leggiJpeg(percorso: string): { larghezza: number; altezza: number; exif: boolean } {
  const b = readFileSync(percorso)
  let exif = false
  for (let i = 2; i < b.length; ) {
    if (b[i] !== 0xff) throw new Error('JPEG non valido')
    const tipo = b[i + 1]
    const lunghezza = b.readUInt16BE(i + 2)
    if (tipo === 0xe1 && b.toString('ascii', i + 4, i + 8) === 'Exif') exif = true
    if (tipo >= 0xc0 && tipo <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(tipo)) {
      return { altezza: b.readUInt16BE(i + 5), larghezza: b.readUInt16BE(i + 7), exif }
    }
    i += 2 + lunghezza
  }
  throw new Error('Dimensioni non trovate')
}
