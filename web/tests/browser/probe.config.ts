import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

import suite from '../../playwright.config.ts'

/**
 * The suite's configuration pointed at a directory of one-off specs outside it, such as
 * `tmp/<name>/` in a worktree, so a probe needs no configuration of its own and no edit to
 * a tracked file. Everything else is the suite's: the projects a file's name selects
 * (`ui-` on the harness, `production-` on the built app), the ports VALKAMA_BROWSER_PORT
 * names and the next one, the bundle built under `test-results/<port>/app` and the check
 * that the app port serves it.
 *
 *   VALKAMA_BROWSER_PORT=9530 VALKAMA_BROWSER_PROBES=../tmp/probe \
 *     npx playwright test --config tests/browser/probe.config.ts
 */
const named = process.env.VALKAMA_BROWSER_PROBES
if (!named) throw new Error('VALKAMA_BROWSER_PROBES must name the directory of the probe specs')

export default defineConfig({
  ...suite,
  // Relative to `web/`, where the command runs, as every other path a run is given.
  testDir: isAbsolute(named) ? named : resolve(named),
  // A spec outside `web/` has no `node_modules` above it; this resolves its imports.
  tsconfig: fileURLToPath(new URL('probe.tsconfig.json', import.meta.url)),
})
