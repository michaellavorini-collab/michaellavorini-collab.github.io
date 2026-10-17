/** Prove dirette (senza emulatore) di cifratura, OAuth e implementazioni dell'Archivio. */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cifra, decifra } from '../functions/src/cifratura'
import { nomeCartellaSicuro, ArchivioScollegato } from '../functions/src/archivio/Archivio'
import { GoogleDriveArchivio, linkMiniatura, testoPerRicerca } from '../functions/src/archivio/GoogleDriveArchivio'
import { ArchivioSimulato } from '../functions/src/archivio/ArchivioSimulato'
import { scambiaCodice, SCOPE_DRIVE_FILE, urlAutorizzazione } from '../functions/src/drive/oauth'

const CHIAVE = randomBytes(32).toString('base64')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('cifratura dei token', () => {
  it('cifra e decifra, e ogni volta il risultato è diverso', () => {
    const a = cifra('1//refresh-token-segreto', 'dittaA', CHIAVE)
    const b = cifra('1//refresh-token-segreto', 'dittaA', CHIAVE)
    expect(a).toMatch(/^v1:/)
    expect(a).not.toBe(b)
    expect(a).not.toContain('refresh-token-segreto')
    expect(decifra(a, 'dittaA', CHIAVE)).toBe('1//refresh-token-segreto')
  })

  it("non si decifra con un'altra ditta, un'altra chiave o un dato alterato", () => {
    const c = cifra('segreto', 'dittaA', CHIAVE)
    expect(() => decifra(c, 'dittaB', CHIAVE)).toThrow()
    expect(() => decifra(c, 'dittaA', randomBytes(32).toString('base64'))).toThrow()
    const alterato = c.slice(0, -4) + (c.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect(() => decifra(alterato, 'dittaA', CHIAVE)).toThrow()
  })

  it('rifiuta una chiave della lunghezza sbagliata', () => {
    expect(() => cifra('x', 'd', randomBytes(16).toString('base64'))).toThrow(/32 byte/)
  })
})

describe('OAuth Google', () => {
  it("l'indirizzo di consenso chiede SOLO drive.file, con refresh token", () => {
    const u = new URL(urlAutorizzazione({ clientId: 'id-client', urlRitorno: 'http://localhost:5001/x/driveRitorno' }, 'stato123', 'a@b.it'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('scope')).toBe(SCOPE_DRIVE_FILE)
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('state')).toBe('stato123')
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:5001/x/driveRitorno')
    expect(u.searchParams.get('login_hint')).toBe('a@b.it')
  })

  const config = { clientId: 'id', clientSecret: 'segreto', urlRitorno: 'http://r' }
  const rispostaToken = (corpo: object, status = 200) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(corpo), { status })))

  it('scambia il codice e restituisce il refresh token', async () => {
    rispostaToken({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: SCOPE_DRIVE_FILE })
    const r = await scambiaCodice(config, 'codice')
    expect(r.refreshToken).toBe('rt')
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(String(init.body)).toContain('grant_type=authorization_code')
  })

  it("rifiuta se l'utente ha tolto il permesso su Drive", async () => {
    rispostaToken({ access_token: 'at', refresh_token: 'rt', scope: 'openid' })
    await expect(scambiaCodice(config, 'c')).rejects.toMatchObject({ motivo: 'permesso-mancante' })
  })

  it('rifiuta se manca il refresh token', async () => {
    rispostaToken({ access_token: 'at', scope: SCOPE_DRIVE_FILE })
    await expect(scambiaCodice(config, 'c')).rejects.toMatchObject({ motivo: 'senza-refresh' })
  })

  it('segnala un errore di Google', async () => {
    rispostaToken({ error: 'invalid_grant' }, 400)
    await expect(scambiaCodice(config, 'c')).rejects.toMatchObject({ motivo: 'google' })
  })
})

describe('GoogleDriveArchivio', () => {
  const config = { clientId: 'id', clientSecret: 'segreto' }
  const accesso = { accessToken: 'at', scadeIl: Date.now() + 3_600_000 }

  /** Finto Google: risponde in base all'indirizzo e registra le chiamate. */
  function fintoGoogle(risposte: Record<string, () => Response>) {
    const chiamate: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      chiamate.push({ url, init })
      const chiave = Object.keys(risposte).find((k) => `${init?.method ?? 'GET'} ${url}`.startsWith(k))
      return chiave ? risposte[chiave]() : new Response('non previsto', { status: 500 })
    }))
    return chiamate
  }
  const json = (o: object, status = 200) => () => new Response(JSON.stringify(o), { status })

  it('trova la cartella esistente senza crearne un doppione', async () => {
    const chiamate = fintoGoogle({ 'GET https://www.googleapis.com/drive/v3/files?': json({ files: [{ id: 'esistente' }] }) })
    const id = await new GoogleDriveArchivio(config, 'rt', accesso).assicuraCartella('Foto Cantieri')
    expect(id).toBe('esistente')
    expect(chiamate).toHaveLength(1)
    const q = new URL(chiamate[0].url).searchParams.get('q')!
    expect(q).toContain("name = 'Foto Cantieri'")
    expect(q).toContain("'root' in parents")
    expect(q).toContain('trashed = false')
    expect((chiamate[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer at')
  })

  it('crea la cartella dentro il padre se non esiste', async () => {
    const chiamate = fintoGoogle({
      'GET https://www.googleapis.com/drive/v3/files?': json({ files: [] }),
      'POST https://www.googleapis.com/drive/v3/files': json({ id: 'nuova' }),
    })
    const id = await new GoogleDriveArchivio(config, 'rt', accesso).assicuraCartella("2026-014 L'Aquila", 'padre1')
    expect(id).toBe('nuova')
    expect(new URL(chiamate[0].url).searchParams.get('q')).toContain("name = '2026-014 L\\'Aquila'")
    expect(JSON.parse(String(chiamate[1].init!.body))).toEqual({
      name: "2026-014 L'Aquila", mimeType: 'application/vnd.google-apps.folder', parents: ['padre1'],
    })
  })

  it('rinnova il token scaduto, e se il permesso è revocato segnala archivio scollegato', async () => {
    fintoGoogle({
      'POST https://oauth2.googleapis.com/token': json({ error: 'invalid_grant' }, 400),
    })
    const a = new GoogleDriveArchivio(config, 'rt-revocato')
    await expect(a.account()).rejects.toBeInstanceOf(ArchivioScollegato)
  })

  it("legge l'account collegato", async () => {
    fintoGoogle({
      'POST https://oauth2.googleapis.com/token': json({ access_token: 'nuovo', expires_in: 3600 }),
      'GET https://www.googleapis.com/drive/v3/about': json({ user: { emailAddress: 'titolare@gmail.com' } }),
    })
    expect(await new GoogleDriveArchivio(config, 'rt').account()).toBe('titolare@gmail.com')
  })

  it('apre il caricamento resumable passando Origin e dimensione, e restituisce l\'indirizzo', async () => {
    const chiamate = fintoGoogle({
      'POST https://www.googleapis.com/upload/drive/v3/files?': () =>
        new Response('', { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=XYZ' } }),
    })
    const r = await new GoogleDriveArchivio(config, 'rt', accesso).apriCaricamento({
      cartellaId: 'cart1', nomeFile: 'f.jpg', mimeType: 'image/jpeg', dimensione: 123456, origine: 'https://app.esempio.it',
    })
    expect(r.urlCaricamento).toBe('https://www.googleapis.com/upload/drive/v3/files?upload_id=XYZ')
    const { url, init } = chiamate[0]
    expect(new URL(url).searchParams.get('uploadType')).toBe('resumable')
    const h = init!.headers as Record<string, string>
    expect(h.Origin).toBe('https://app.esempio.it')
    expect(h['X-Upload-Content-Type']).toBe('image/jpeg')
    expect(h['X-Upload-Content-Length']).toBe('123456')
    expect(JSON.parse(String(init!.body))).toEqual({ name: 'f.jpg', parents: ['cart1'], mimeType: 'image/jpeg' })
  })

  it('caricamento: token non più valido = archivio scollegato', async () => {
    fintoGoogle({ 'POST https://www.googleapis.com/upload/drive/v3/files?': () => new Response('', { status: 401 }) })
    await expect(new GoogleDriveArchivio(config, 'rt', accesso).apriCaricamento({
      cartellaId: 'c', nomeFile: 'f.jpg', mimeType: 'image/jpeg', dimensione: 1, origine: 'https://a.it',
    })).rejects.toBeInstanceOf(ArchivioScollegato)
  })

  it('legge le informazioni del file; nel cestino o inesistente = null', async () => {
    fintoGoogle({
      'GET https://www.googleapis.com/drive/v3/files/f1?': json({ id: 'f1', name: 'a.jpg', mimeType: 'image/jpeg', size: '5000', parents: ['cart1'] }),
      'GET https://www.googleapis.com/drive/v3/files/f2?': json({ id: 'f2', name: 'b.jpg', mimeType: 'image/jpeg', size: '1', trashed: true }),
      'GET https://www.googleapis.com/drive/v3/files/f3?': json({ error: 'notFound' }, 404),
    })
    const a = new GoogleDriveArchivio(config, 'rt', accesso)
    expect(await a.infoFile('f1')).toEqual({ id: 'f1', nome: 'a.jpg', mimeType: 'image/jpeg', dimensione: 5000, cartelle: ['cart1'] })
    expect(await a.infoFile('f2')).toBeNull()
    expect(await a.infoFile('f3')).toBeNull()
  })

  it('miniatura: chiede a Drive la misura voluta, con il token', async () => {
    const chiamate = fintoGoogle({
      'GET https://www.googleapis.com/drive/v3/files/f1?': json({ thumbnailLink: 'https://lh3.googleusercontent.com/abc=s220' }),
      'GET https://lh3.googleusercontent.com/abc=s400': () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }),
    })
    const m = await new GoogleDriveArchivio(config, 'rt', accesso).miniatura('f1', 400)
    expect(m).toEqual({ contenuto: Buffer.from([1, 2, 3]), mimeType: 'image/jpeg' })
    expect((chiamate[1].init!.headers as Record<string, string>).Authorization).toBe('Bearer at')
  })

  it('miniatura non ancora pronta su Drive: passa la foto stessa', async () => {
    const chiamate = fintoGoogle({
      'GET https://www.googleapis.com/drive/v3/files/f1?fields': json({}),
      'GET https://www.googleapis.com/drive/v3/files/f1?alt=media': () => new Response(new Uint8Array([9]), { headers: { 'Content-Type': 'image/jpeg' } }),
    })
    const m = await new GoogleDriveArchivio(config, 'rt', accesso).miniatura('f1', 400)
    expect(m!.contenuto).toEqual(Buffer.from([9]))
    expect(chiamate[1].url).toContain('alt=media')
  })

  it('miniatura di un file nel cestino o sparito: null', async () => {
    fintoGoogle({
      'GET https://www.googleapis.com/drive/v3/files/f2?': json({ trashed: true }),
      'GET https://www.googleapis.com/drive/v3/files/f3?': json({ error: 'notFound' }, 404),
    })
    const a = new GoogleDriveArchivio(config, 'rt', accesso)
    expect(await a.miniatura('f2', 400)).toBeNull()
    expect(await a.miniatura('f3', 400)).toBeNull()
  })

  it('cambia la misura nel link della miniatura', () => {
    expect(linkMiniatura('https://lh3.googleusercontent.com/abc=s220', 400)).toBe('https://lh3.googleusercontent.com/abc=s400')
    expect(linkMiniatura('https://lh3.googleusercontent.com/abc=s220-c', 1600)).toBe('https://lh3.googleusercontent.com/abc=s1600')
    expect(linkMiniatura('https://lh3.googleusercontent.com/abc', 400)).toBe('https://lh3.googleusercontent.com/abc=s400')
  })

  it('protegge le ricerche dagli apici', () => {
    expect(testoPerRicerca("a'b\\c")).toBe("a\\'b\\\\c")
  })
})

describe('ArchivioSimulato', () => {
  it('esiste solo nell\'emulatore', () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', '')
    expect(() => new ArchivioSimulato('dittaA')).toThrow(/solo con gli emulatori/)
  })

  it('crea cartelle sul disco senza mai uscire dalla cartella della ditta', async () => {
    const base = mkdtempSync(join(tmpdir(), 'archivio-'))
    try {
      vi.stubEnv('FUNCTIONS_EMULATOR', 'true')
      vi.stubEnv('ARCHIVIO_SIMULATO_DIR', base)
      const a = new ArchivioSimulato('dittaA')
      const radice = await a.assicuraCartella('Foto Cantieri')
      expect(await a.assicuraCartella('Foto Cantieri')).toBe(radice)
      const commessa = await a.assicuraCartella('../../fuori', radice)
      expect(statSync(join(base, 'dittaA', 'Foto Cantieri', '..-..-fuori')).isDirectory()).toBe(true)
      expect(await a.cartellaEsiste(commessa)).toBe(true)
      const fuori = Buffer.from('../dittaB', 'utf8').toString('base64url')
      expect(() => a.percorso(fuori)).toThrow(/non valido/)
      expect(await a.cartellaEsiste(fuori)).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('nomi delle cartelle', () => {
  it('toglie barre e caratteri di controllo', () => {
    expect(nomeCartellaSicuro('  2026/014 \\ caldaia\n ')).toBe('2026-014 - caldaia-')
    expect(nomeCartellaSicuro('..')).toBe('Senza nome')
    expect(nomeCartellaSicuro('')).toBe('Senza nome')
  })
})
