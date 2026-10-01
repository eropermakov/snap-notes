import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests use mocks only: no test may reach a real AI provider or spend API credits.
    restoreMocks: true
  }
})
