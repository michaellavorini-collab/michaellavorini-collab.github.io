import { defineConfig, devices } from '@playwright/test'

/**
 * Prove end-to-end: l'app vera nel browser (telefono simulato) contro gli emulatori,
 * con l'archivio di prova. Si lanciano con `npm run test:e2e`, che avvia anche gli emulatori.
 */
export default defineConfig({
  testDir: 'e2e',
  // Gli emulatori sono condivisi: una prova alla volta.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm --prefix app run dev -- --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
