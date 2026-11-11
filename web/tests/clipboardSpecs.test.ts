/**
 * The browser specs that touch the system clipboard are named in one list, which a run of the
 * allowed set leaves out. A spec that grants or writes the clipboard and is not on it would
 * run with the rest; a name on it that is no longer a spec would let the renamed one back in.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { PlaywrightTestConfig } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clipboardIgnore,
  clipboardListGaps,
  clipboardOptIn,
  clipboardSpecs,
} from './browser/clipboardSpecs.ts'

const suite = fileURLToPath(new URL('browser/', import.meta.url))

function suiteSources(): Map<string, string> {
  return new Map(
    readdirSync(suite)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => [name, readFileSync(`${suite}${name}`, 'utf8')]),
  )
}

const quiet = "import { test } from './test.ts'\ntest('reads', async () => {})\n"

describe('the clipboard specs', () => {
  it('lists every spec of the suite that grants or writes the clipboard, and only specs', () => {
    expect(clipboardListGaps(suiteSources())).toEqual({ unlisted: [], stale: [] })
  })

  it('fails on the suite as it is when one of its clipboard specs is left off', () => {
    const listed = clipboardSpecs.filter((name) => name !== 'production-card-source.spec.ts')
    expect(clipboardListGaps(suiteSources(), listed).unlisted).toEqual([
      'production-card-source.spec.ts',
    ])
  })

  it('catches an unlisted spec that is granted the clipboard', () => {
    const sources = new Map([
      [
        'production-copies.spec.ts',
        "test('copies', async ({ page }) => {\n" +
          "  await page.context().grantPermissions(['clipboard-write'])\n})\n",
      ],
      ['production-quiet.spec.ts', quiet],
    ])
    expect(clipboardListGaps(sources, []).unlisted).toEqual(['production-copies.spec.ts'])
  })

  it('catches an unlisted spec that writes the clipboard through a module it imports', () => {
    const sources = new Map([
      ['ui-copies.spec.ts', "import { copy } from './copyHelper.ts'\ntest('copies', copy)\n"],
      [
        'copyHelper.ts',
        "import './test.ts'\n" +
          'export const copy = ({ page }) =>\n' +
          "  page.evaluate(() => navigator.clipboard.writeText('x'))\n",
      ],
      ['test.ts', "import './copyHelper.ts'\n"],
    ])
    expect(clipboardListGaps(sources, []).unlisted).toEqual(['ui-copies.spec.ts'])
  })

  it('leaves alone a spec that only replaces the clipboard with one kept in the page', () => {
    const stub =
      "Object.defineProperty(navigator, 'clipboard', {\n" +
      '  value: { writeText: (text: string) => Promise.resolve() },\n})\n'
    expect(clipboardListGaps(new Map([['ui-stub.spec.ts', stub]]), []).unlisted).toEqual([])
  })

  it('reports a listed name that is no longer a spec', () => {
    const sources = new Map([['production-card-notes.spec.ts', quiet]])
    expect(
      clipboardListGaps(sources, ['production-card-notes.spec.ts', 'production-gone.spec.ts'])
        .stale,
    ).toEqual(['production-gone.spec.ts'])
  })
})

type Pattern = PlaywrightTestConfig['testMatch']

/** Whether a file's absolute path matches a pattern the configuration states as RegExps. */
function matches(pattern: Pattern, file: string): boolean {
  return [pattern ?? []].flat().some((one) => {
    if (!(one instanceof RegExp)) throw new TypeError(`not a RegExp: ${String(one)}`)
    return one.test(file)
  })
}

/** The specs of the suite on disk that `playwright.config.ts`, loaded under `env`, selects. */
async function configSelects(env: Record<string, string | undefined>): Promise<string[]> {
  vi.resetModules()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  const { default: config } = await import('../playwright.config.ts')
  return readdirSync(suite)
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) =>
      (config.projects ?? []).some(
        (project) =>
          matches(project.testMatch, `${suite}${name}`) &&
          !matches(project.testIgnore ?? config.testIgnore, `${suite}${name}`),
      ),
    )
}

describe('the browser configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('selects no listed spec unless the run opts in, and every other spec as before', async () => {
    const mocked = { VALKAMA_BROWSER_STORE: undefined }
    const optedIn = await configSelects({ ...mocked, [clipboardOptIn]: '1' })
    expect(optedIn).toEqual(expect.arrayContaining([...clipboardSpecs]))
    expect(await configSelects({ ...mocked, [clipboardOptIn]: undefined })).toEqual(
      optedIn.filter((name) => !clipboardSpecs.includes(name)),
    )
  })

  it('opts in on `1` only, and leaves out a spec whose name merely begins with a listed one', () => {
    expect(clipboardIgnore({ [clipboardOptIn]: 'yes' })).toHaveLength(clipboardSpecs.length)
    const ignored = (name: string) => clipboardIgnore({}).some((one) => one.test(`/web/${name}`))
    expect(ignored('production-open-session.spec.ts')).toBe(true)
    expect(ignored('production-open-session-app.spec.ts')).toBe(false)
  })
})
