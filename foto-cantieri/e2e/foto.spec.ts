import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { CARTELLA_FOTO, dittaPronta, entraComeOperatore, fotoNellArchivio, leggiJpeg, nuovoTelefono, svuotaEmulatori } from './aiuti'

test.beforeEach(svuotaEmulatori)

test('caricamento: foto compresse a 1600 px, girate giuste, senza EXIF, nelle cartelle giuste', async ({ browser }) => {
  const inizio = Date.now()
  const { codiceDitta, codiceMario } = await dittaPronta(browser)
  const { pagina } = await nuovoTelefono(browser)
  await entraComeOperatore(pagina, codiceDitta, codiceMario)
  await pagina.getByText('Sostituzione caldaia').click()
  await pagina.getByText('Dopo', { exact: true }).click()

  await pagina.locator('input[type=file][multiple]').setInputFiles([
    join(CARTELLA_FOTO, 'orizzontale.jpg'),
    join(CARTELLA_FOTO, 'verticale-exif6.jpg'),
  ])
  await expect(pagina.getByText('(2/2 salvate)')).toBeVisible()

  const file = fotoNellArchivio(inizio)
  expect(file).toHaveLength(2)
  for (const f of file) {
    expect(f).toContain(join('Foto Cantieri', '2026-014 - Sostituzione caldaia', 'Dopo'))
    expect(f).toMatch(/2026-014_Dopo_\d{8}-\d{6}_[0-9a-f]{6}\.jpg$/)
  }
  const dimensioni = file.map(leggiJpeg).sort((a, b) => a.larghezza - b.larghezza)
  // La foto "verticale" (EXIF orientamento 6) esce girata: 1200×1600.
  expect(dimensioni).toEqual([
    { larghezza: 1200, altezza: 1600, exif: false },
    { larghezza: 1600, altezza: 1200, exif: false },
  ])

  // Anche dal pulsante della fotocamera, nella cartella scelta.
  await pagina.getByText('Prima', { exact: true }).click()
  await pagina.locator('input[type=file][capture]').setInputFiles(join(CARTELLA_FOTO, 'orizzontale.jpg'))
  await expect(pagina.getByText('(3/3 salvate)')).toBeVisible()
  expect(fotoNellArchivio(inizio).filter((f) => f.includes(join('2026-014 - Sostituzione caldaia', 'Prima')))).toHaveLength(1)
})

test('galleria: 12 alla volta dalle più recenti, vista grande, stessa galleria per il titolare', async ({ browser }) => {
  const { titolare, codiceDitta, codiceMario } = await dittaPronta(browser)
  const { pagina } = await nuovoTelefono(browser)
  await entraComeOperatore(pagina, codiceDitta, codiceMario)
  await pagina.getByText('Sostituzione caldaia').click()
  await expect(pagina.getByText('Ancora nessuna foto in questa commessa.')).toBeVisible()

  await pagina.locator('input[type=file][multiple]').setInputFiles(
    Array.from({ length: 13 }, (_, i) => join(CARTELLA_FOTO, i % 2 ? 'verticale-exif6.jpg' : 'orizzontale.jpg')),
  )
  await expect(pagina.getByText('(13/13 salvate)')).toBeVisible({ timeout: 60_000 })

  const tessere = pagina.locator('.griglia img')
  await expect(tessere).toHaveCount(12)
  await pagina.getByRole('button', { name: 'Carica altre foto' }).click()
  await expect(tessere).toHaveCount(13)
  await expect(pagina.getByRole('button', { name: 'Carica altre foto' })).toHaveCount(0)

  // Vista grande con cartella, data e autore.
  await pagina.locator('.tessera').first().click()
  await expect(pagina.locator('.visore img')).toBeVisible()
  await expect(pagina.locator('.visore-info')).toContainText('Mario')
  await pagina.getByRole('button', { name: 'Chiudi' }).click()

  // Il titolare vede le stesse foto da Commesse → Foto.
  await titolare.pagina.getByRole('button', { name: 'Foto', exact: true }).click()
  await expect(titolare.pagina.locator('.griglia img')).toHaveCount(12)
})
