import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'
import type { PlaywrightTestConfig } from '@playwright/test'

import suite from '../../playwright.config.ts'

/**
 * The suite's configuration pointed at a directory of one-off specs outside it, such as
 * `tmp/<name>/` in a worktree, so a probe needs no configuration of its own and no edit to
 * a tracked file. Everything else is the suite's: the projects a file's name selects
 * (`ui-` on the harness, `production-` on the built app), the ports VALKAMA_BROWSER_PORT
 * names and the next one, the bundle built under `test-results/<port>/app` and the check
 * that the app port serves it.
 *
 * A probe is an ES module, `<project>-<name>.spec.mts`, because every module of the suite is
 * one and the run has loaded some of them already: the configuration, and its global setup
 * in the runner. A `.spec.ts` outside `web/` is a CommonJS script, and its `require` of a
 * module the run has already loaded as an ES module fails.
 *
 *   VALKAMA_BROWSER_PORT=9530 VALKAMA_BROWSER_PROBES=../tmp/probe \
 *     npx playwright test --config tests/browser/probe.config.ts
 */
const named = process.env.VALKAMA_BROWSER_PROBES
if (!named) throw new Error('VALKAMA_BROWSER_PROBES must name the directory of the probe specs')

type Project = NonNullable<PlaywrightTestConfig['projects']>[number]

/** The project with its selection by name taking a probe's `.spec.mts` as well. */
function takingProbes(project: Project): Project {
  const pattern = project.testMatch
  if (!(pattern instanceof RegExp) || !pattern.source.endsWith(String.raw`\.spec\.ts$`))
    throw new Error(`project ${project.name} must select its specs as …\\.spec\\.ts$`)
  const source = `${pattern.source.slice(0, -'ts$'.length)}m?ts$`
  return { ...project, testMatch: new RegExp(source, pattern.flags) }
}

export default defineConfig({
  ...suite,
  // Relative to `web/`, where the command runs, as every other path a run is given.
  testDir: isAbsolute(named) ? named : resolve(named),
  projects: (suite.projects ?? []).map((project) => takingProbes(project)),
  // A spec outside `web/` has no `node_modules` above it; this resolves its imports, and with
  // `allowJs` those of a `.mts` too. Playwright applies it to every file the run loads, the
  // suite's own included, and a mapping skips the package's `exports`, so it names the ES
  // module entry: the CommonJS one gives an ES module no named `test`.
  tsconfig: fileURLToPath(new URL('probe.tsconfig.json', import.meta.url)),
})
