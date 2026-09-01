import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The Python server hosts dist/ next to it and owns /api, so the dev server
// proxies there instead of duplicating any backend behaviour.
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Vite 7 defaults `cssTarget` to `build.target`, which is chrome107, and
  // esbuild flattens any syntax the target predates. Native nesting is the one
  // this project is about to use, and the desktop app runs Chromium 150 while a
  // browser reader is on an evergreen one, so lowering it would spend selector
  // clarity to reach nobody. Verified against every stylesheet here: at both
  // targets today's output is byte-identical, so this only decides what happens
  // to the nesting that arrives next.
  build: { outDir: 'dist', emptyOutDir: true, cssTarget: 'chrome150' },
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
