import { realpathSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, searchForWorkspaceRoot } from 'vite'

import base from '../../vite.config.ts'

const web = fileURLToPath(new URL('../..', import.meta.url))

// A worktree's `node_modules` may be a link to the main checkout's, and Vite serves a
// dependency's file from where the link leads, outside the workspace it allows by default:
// the interface font's files were refused there (403), and every harness spec measured text
// in the fallback. The dependencies' real directory is allowed as well; in the main
// checkout it is inside the workspace already, and nothing changes.
const dependencies = realpathSync(fileURLToPath(new URL('../../node_modules', import.meta.url)))

// Browser fixtures own their API responses. An unhandled request must never
// fall through to the owner's running store through the development proxy.
export default defineConfig({
  ...base,
  server: {
    ...base.server,
    proxy: {},
    fs: { allow: [searchForWorkspaceRoot(web), dependencies] },
  },
  preview: { ...base.preview, proxy: {} },
})
