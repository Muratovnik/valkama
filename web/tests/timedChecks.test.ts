/**
 * The browser tests that bound a time run after the rest of a run and alone (`timedChecks.ts`).
 * Configuration is what silently reverts and no browser test sees: a project dropped from the
 * timed one's teardown would run beside it again, and the run would still pass.
 */

import { describe, expect, it, vi } from 'vitest'

import { timedList, timedProject, timedSpecs, timedTag, timedTitle } from './browser/timedChecks.ts'

/** The projects of `playwright.config.ts` as a mocked-app run loads them. */
async function projects() {
  vi.stubEnv('VALKAMA_BROWSER_STORE', undefined)
  vi.stubEnv(timedList, undefined)
  try {
    const { default: config } = await import('../playwright.config.ts')
    return config.projects ?? []
  } finally {
    vi.unstubAllEnvs()
  }
}

/** A test's title with its tags as Playwright matches a project's `grep` against it. */
const title = (...tags: string[]) =>
  ['production', 'production-hint.spec.ts', 'a hint shows at once', ...tags].join(' ')

describe('the timed browser tests', () => {
  it('run after every other project, whatever it ended in, in one worker', async () => {
    const all = await projects()
    const timed = all.filter((project) => project.name === timedProject)
    expect(timed).toHaveLength(1)
    expect(timed[0]?.workers).toBe(1)
    // A teardown with dependencies is refused by Playwright, and one depended on is skipped
    // when what it depends on fails.
    expect(timed[0]?.dependencies ?? []).toEqual([])
    const others = all.filter((project) => project.name !== timedProject)
    expect(others.length).toBeGreaterThan(0)
    expect(others.map((project) => [project.name, project.teardown])).toEqual(
      others.map((project) => [project.name, timedProject]),
    )
  })

  it('take the production specs, the tagged tests of them and no other', async () => {
    const all = await projects()
    const timed = all.find((project) => project.name === timedProject)
    const production = all.find((project) => project.name === 'production')
    expect(String(timed?.testMatch)).toBe(String(production?.testMatch))
    expect(timed?.grep).toBe(timedTitle)
    expect(production?.grepInvert).toBe(timedTitle)
  })

  it('take only the production specs a run’s list names, since Playwright runs them whole', () => {
    const production = /(?:^|[\\/])production-(?!locale\.)[a-z0-9-]+\.spec\.ts$/
    const list =
      'production-a.spec.ts\r\nui-b.spec.ts\nproduction-locale.spec.ts\nproduction-c.d.spec.ts\n'
    const taken = timedSpecs(production, { [timedList]: 'list.txt' }, () => list)
    const at = (name: string) => taken.test(`C:\\web\\tests\\browser\\${name}`)
    expect(at('production-a.spec.ts')).toBe(true)
    expect(at('production-ab.spec.ts')).toBe(false)
    expect(at('ui-b.spec.ts')).toBe(false)
    expect(at('production-locale.spec.ts')).toBe(false)
    expect(String(taken).endsWith(String.raw`\.spec\.ts$/`)).toBe(true)
    expect(timedSpecs(production, {}, () => list)).toBe(production)
    const none = timedSpecs(production, { [timedList]: 'list.txt' }, () => 'ui-b.spec.ts\n')
    expect(none.test('production-a.spec.ts')).toBe(false)
  })

  it('are told by the tag as a word among the tags', () => {
    expect(timedTitle.test(title(timedTag))).toBe(true)
    expect(timedTitle.test(title('@slow', timedTag, '@wide'))).toBe(true)
    expect(timedTitle.test(title())).toBe(false)
    expect(timedTitle.test(title(`${timedTag}-not`, `x${timedTag}`))).toBe(false)
  })
})
