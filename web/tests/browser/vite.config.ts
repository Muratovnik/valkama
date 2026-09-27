import { defineConfig } from 'vite'

import base from '../../vite.config.ts'

// Browser fixtures own their API responses. An unhandled request must never
// fall through to the owner's running store through the development proxy.
export default defineConfig({
  ...base,
  server: { ...base.server, proxy: {} },
  preview: { ...base.preview, proxy: {} },
})
