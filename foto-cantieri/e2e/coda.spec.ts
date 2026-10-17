import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { CARTELLA_FOTO, dittaPronta, entraComeOperatore, nuovaPagina, svuotaEmulatori } from './aiuti'

test.beforeEach(svuotaEmulatori)

/** Quante foto sono ancora salvate nella memoria del telefono (IndexedDB). */
const inMemoria = (p: Page) =>
  p.evaluate(() => new Promise<number>((ok, ko) => {
    const r = indexedDB.open('foto-cantieri')
    r.onerror = () => ko(r.error)
    r.onsuccess = () => {
      const q = r.result.transaction('coda').objectStore('coda').count()
      q.onsuccess = () => ok(q.result)
    }
  }))

test('senza campo le foto aspettano sul telefono e partono da sole, anche dopo aver chiuso l\'app', async ({ browser }) => {
  const { codiceDitta, codiceMario } = await dittaPronta(browser)
  const contesto = await browser.newContext()
  let pagina = await nuovaPagina(contesto)
  await entraComeOperatore(pagina, codiceDitta, codiceMario)
  await pagina.getByText('Sostituzione caldaia').click()
  const galleria = () => pagina.locator('input[type=file][multiple]')

  // 1) Senza rete: la foto resta in attesa e parte quando torna la rete.
  await contesto.setOffline(true)
  await galleria().setInputFiles(join(CARTELLA_FOTO, 'orizzontale.jpg'))
  await expect(pagina.getByText('partirà quando torna il campo')).toBeVisible()
  await contesto.setOffline(false)
  await expect(pagina.getByText('(1/1 salvate)')).toBeVisible()

  // 2) Due foto senza rete, poi l'app si chiude: restano salvate sul telefono.
  await contesto.setOffline(true)
  await galleria().setInputFiles([join(CARTELLA_FOTO, 'orizzontale.jpg'), join(CARTELLA_FOTO, 'verticale-exif6.jpg')])
  await expect(pagina.locator('.coda-voce.riprova')).toHaveCount(2)
  expect(await inMemoria(pagina)).toBe(2)
  await pagina.close()
  await contesto.setOffline(false)

  // Riaperta con la rete: la sessione resta e la coda riparte da sola.
  pagina = await nuovaPagina(contesto)
  await pagina.goto('/')
  await expect(pagina.getByRole('heading', { name: 'Ciao Mario' })).toBeVisible()
  await expect(pagina.getByText(/foto da inviare/)).toHaveCount(0, { timeout: 30_000 })
  await pagina.getByText('Sostituzione caldaia').click()
  await expect(pagina.locator('.griglia img')).toHaveCount(3)
  // Salvate nell'archivio: tolte dal telefono.
  expect(await inMemoria(pagina)).toBe(0)
})

test('se l\'invio si interrompe, "Riprova" completa senza doppioni', async ({ browser }) => {
  const { codiceDitta, codiceMario } = await dittaPronta(browser)
  const contesto = await browser.newContext()
  const pagina = await nuovaPagina(contesto)
  await entraComeOperatore(pagina, codiceDitta, codiceMario)
  await pagina.getByText('Sostituzione caldaia').click()

  // La prima PUT verso l'archivio cade.
  let invii = 0
  await pagina.route('**/caricamentoSimulato**', (r) => (invii++ === 0 ? r.abort('connectionreset') : r.continue()))
  await pagina.locator('input[type=file][capture]').setInputFiles(join(CARTELLA_FOTO, 'orizzontale.jpg'))
  await expect(pagina.getByText('Connessione interrotta durante l\'invio.')).toBeVisible()
  await pagina.getByRole('button', { name: 'Riprova' }).click()
  await expect(pagina.getByText('(1/1 salvate)')).toBeVisible()
  await expect(pagina.locator('.griglia img')).toHaveCount(1)
})
