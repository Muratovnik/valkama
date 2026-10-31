import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The Python server hosts dist/ next to it and owns /api, so the dev server
// proxies there instead of duplicating any backend behaviour.
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Vite 8 defaults `cssTarget` to `build.target`, which is chrome111, and
  // Lightning CSS, its CSS minifier, lowers any syntax the target predates.
  // Native nesting is the one this project uses, and Chrome 111 predates it:
  // at the default every nested rule is flattened back into repeated selectors
  // and `user-select` gains a `-webkit-` twin. The desktop app runs Chromium 156
  // while a browser reader is on an evergreen one, so lowering it would spend
  // selector clarity to reach nobody.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssTarget: 'chrome150',
    rolldownOptions: {
      output: {
        // The libraries the first screen runs — Vue, the router, i18n, zod,
        // Reka — change far less often than the application, so they ship as
        // their own chunk and keep their hash, and the cache, across releases.
        // `$initial` keeps the group to what the entry imports statically: a
        // library only a lazy view uses, such as Vue Flow, stays in that view's
        // chunk instead of being pulled forward onto the first screen.
        codeSplitting: {
          groups: [{ name: 'vendor', test: /[\\/]node_modules[\\/]/, tags: ['$initial'] }],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8642',
        changeOrigin: true,
      },
    },
  },
})
