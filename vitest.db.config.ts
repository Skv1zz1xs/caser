import { defineConfig } from 'vitest/config'

// Интеграционные тесты серверной логики. Нужен локальный Postgres:
// DEV_PG_URL (по умолчанию postgres://postgres:postgres@127.0.0.1:5432/postgres)
export default defineConfig({
  test: {
    include: ['tests/db/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
