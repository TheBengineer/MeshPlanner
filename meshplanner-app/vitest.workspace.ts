import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'jsdom',
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/tests/setup.ts'],
      include: ['src/tests/**/*.test.{ts,tsx}'],
      exclude: ['src/tests/cross_validation/**'],
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  },
  {
    test: {
      name: 'cross-validation',
      environment: 'node',
      include: ['src/tests/cross_validation/**/*.test.{ts,tsx}'],
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  },
])
