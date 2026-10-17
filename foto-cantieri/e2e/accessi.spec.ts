import { expect, test } from '@playwright/test'
import { dittaPronta, entraComeOperatore, nuovoTelefono, svuotaEmulatori } from './aiuti'

test.beforeEach(svuotaEmulatori)

test('titolare e operatore: accesso, codice sbagliato, disattivazione immediata e riattivazione', async ({ browser }) => {
  const { titolare, codiceDitta, codiceMario } = await dittaPronta(browser)
  const { pagina: operatore } = await nuovoTelefono(browser)

  // Codice personale sbagliato: messaggio generico.
  const sbagliato = codiceMario === '00000000' ? '11111111' : '00000000'
  await entraComeOperatore(operatore, codiceDitta.toLowerCase(), sbagliato)
  await expect(operatore.getByText('Codice ditta o codice personale non corretti.')).toBeVisible()

  // Codici giusti (il codice ditta anche in minuscolo): vede le commesse attive.
  await operatore.getByLabel('Codice personale').fill(codiceMario)
  await operatore.getByRole('button', { name: 'Entra', exact: true }).click()
  await expect(operatore.getByRole('heading', { name: 'Ciao Mario' })).toBeVisible()
  await expect(operatore.getByText('Sostituzione caldaia')).toBeVisible()

  // Il titolare lo disattiva: l'operatore con l'app aperta torna subito all'accesso.
  await titolare.pagina.getByRole('tab', { name: 'Operatori' }).click()
  await titolare.pagina.getByRole('button', { name: 'Disattiva' }).click()
  await expect(operatore.getByText('Il tuo accesso è stato disattivato. Rivolgiti al titolare.')).toBeVisible()

  // Non può rientrare finché è disattivato.
  await operatore.getByLabel('Codice personale').fill(codiceMario)
  await operatore.getByRole('button', { name: 'Entra', exact: true }).click()
  await expect(operatore.getByText('Il tuo accesso è disattivato. Rivolgiti al titolare.')).toBeVisible()

  // Riattivato, rientra.
  await titolare.pagina.getByRole('button', { name: 'Riattiva' }).click()
  await expect(titolare.pagina.getByRole('button', { name: 'Disattiva' })).toBeVisible()
  await operatore.getByLabel('Codice personale').fill(codiceMario)
  await operatore.getByRole('button', { name: 'Entra', exact: true }).click()
  await expect(operatore.getByRole('heading', { name: 'Ciao Mario' })).toBeVisible()
})

test('il titolare resta dentro dopo una ricarica della pagina', async ({ browser }) => {
  const { titolare, codiceDitta } = await dittaPronta(browser)
  await titolare.pagina.reload()
  await expect(titolare.pagina.getByRole('heading', { name: 'Termoidraulica Rossi' })).toBeVisible()
  await expect(titolare.pagina.locator('.codice-grande')).toHaveText(codiceDitta)
})
