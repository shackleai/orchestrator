import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

export default defineConfig({
  resolve: {
    alias: {
      '@shackleai/db': resolve(root, 'packages/db/dist/index.js'),
      '@shackleai/shared': resolve(root, 'packages/shared/dist/index.js'),
      '@shackleai/core': resolve(root, 'packages/core/dist/index.js'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
})
