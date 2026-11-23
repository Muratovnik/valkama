/**
 * A probe spec kept outside the suite runs through `tests/browser/probe.config.ts` with no file
 * of its own beside it, written as `.agents/rules/quality-gates.md` says: an ES module named
 * `<project>-<name>.spec.mts` that imports `expect` from `@playwright/test`, the app through
 * `@/`, and the suite's `test` and helpers by a relative path.
 *
 * `--list` loads the configuration and then the probe in one process, as each worker of a run
 * does: a probe that cannot share the modules the configuration loaded, or whose
 * `@playwright/test` lacks the named exports, fails here as it would there. The global setup,
 * which `--list` does not run, loads modules of the suite in the runner the same way.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const web = fileURLToPath(new URL('..', import.meta.url))
const playwright = join(web, 'node_modules/@playwright/test/cli.js')

/** A probe as the rule shows one: every kind of import it names, and a check each arrived. */
function probeSource(directory: string): string {
  const suite = relative(directory, join(web, 'tests/browser')).replaceAll('\\', '/')
  return [
    "import { expect } from '@playwright/test'",
    "import type { TestInfo } from '@playwright/test'",
    '',
    "import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'",
    '',
    // A helper the configuration itself imports, so the run has loaded it before the probe.
    `import { harnessPort } from '${suite}/browserRun.ts'`,
    `import { test } from '${suite}/test.ts'`,
    '',
    "test('outside probe', ({}, info: TestInfo) => {",
    '  expect(serializePlatformRoute).toBeInstanceOf(Function)',
    '  expect(Number(harnessPort)).toBeGreaterThan(0)',
    '  expect(info.title).toBe("outside probe")',
    '})',
    '',
  ].join('\n')
}

/** What `--list` under the probe configuration says about the probes in `directory`. */
function listProbes(directory: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, VALKAMA_BROWSER_PROBES: directory }
  delete env.VALKAMA_BROWSER_STORE
  const run = spawnSync(
    process.execPath,
    [playwright, 'test', '--config', 'tests/browser/probe.config.ts', '--list'],
    { cwd: web, env, encoding: 'utf8', timeout: 60_000 },
  )
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

describe('the probe configuration', () => {
  let probes = ''

  afterEach(() => {
    if (probes) rmSync(probes, { recursive: true, force: true })
    probes = ''
  })

  it('loads a probe outside the suite that has nothing beside it', () => {
    // Outside `web/`, so neither its `node_modules` nor its package type reaches the probe.
    probes = mkdtempSync(join(tmpdir(), 'valkama-probe-'))
    writeFileSync(join(probes, 'ui-outside-probe.spec.mts'), probeSource(probes))

    const { status, output } = listProbes(probes)

    expect(output).not.toContain('Error')
    expect(status, output).toBe(0)
    expect(output).toMatch(/\[harness\] › ui-outside-probe\.spec\.mts:\d+:\d+ › outside probe/)
    expect(output).toContain('Total: 1 test in 1 file')
  }, 60_000)
})
