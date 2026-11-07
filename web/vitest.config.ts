import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Two projects rather than one environment: contract tests read source files
// from disk, and a DOM shim replaces the global URL that node:url needs.
// Browser specs stay out of both; Playwright owns them. An inline project
// inherits this file's plugins, alias and test options, so each one names only
// what sets it apart; listing the Vue plugin again would compile every SFC twice.
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    clearMocks: true,
    // Off until vitejs/vite-plugin-vue#873 is fixed: with Vitest's persistent module cache an
    // SFC read from the cache never registers the owner of its `<style scoped src>`, so a
    // change to the shared CSS file alone (`reach.css`) fails every suite that loads it.
    fsModuleCache: false,
    projects: [
      {
        test: {
          name: 'contracts',
          environment: 'node',
          include: ['tests/*.{test,spec}.{ts,mts,mjs}'],
        },
      },
      {
        test: {
          name: 'components',
          environment: 'happy-dom',
          include: ['tests/components/**/*.{test,spec}.ts'],
          setupFiles: ['tests/components/setup.ts'],
        },
      },
    ],
  },
})
