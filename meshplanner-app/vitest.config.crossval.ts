import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'cross-validation',
    environment: 'node',
    include: ['src/tests/cross_validation/**/*.test.{ts,tsx}'],
    setupFiles: [],
  },
})
