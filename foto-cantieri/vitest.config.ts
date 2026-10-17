import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Le prove condividono gli emulatori: una alla volta.
    fileParallelism: false,
    testTimeout: 20000,
  },
})
