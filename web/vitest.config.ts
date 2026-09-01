import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const shared = {
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
}

// Two projects rather than one environment: contract tests read source files
// from disk, and a DOM shim replaces the global URL that node:url needs.
// Browser specs stay out of both; Playwright owns them.
export default defineConfig({
  ...shared,
  test: {
    clearMocks: true,
    projects: [
      {
        ...shared,
        test: {
          name: 'contracts',
          environment: 'node',
          include: ['tests/*.{test,spec}.{ts,mts,mjs}'],
          clearMocks: true,
        },
      },
      {
        ...shared,
        test: {
          name: 'components',
          environment: 'happy-dom',
          include: ['tests/components/**/*.{test,spec}.ts'],
          clearMocks: true,
        },
      },
    ],
  },
})
