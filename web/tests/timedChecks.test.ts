/**
 * The browser tests that bound a time run after the rest of a run and alone (`timedChecks.ts`).
 * Configuration is what silently reverts and no browser test sees: a project dropped from the
 * timed one's teardown would run beside it again, and the run would still pass.
 */

import { describe, expect, it, vi } from 'vitest'

import { timedProject, timedTag, timedTitle } from './browser/timedChecks.ts'

/** The projects of `playwright.config.ts` as a mocked-app run loads them. */
async function projects() {
  vi.stubEnv('VALKAMA_BROWSER_STORE', undefined)
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

  it('are told by the tag as a word among the tags', () => {
    expect(timedTitle.test(title(timedTag))).toBe(true)
    expect(timedTitle.test(title('@slow', timedTag, '@wide'))).toBe(true)
    expect(timedTitle.test(title())).toBe(false)
    expect(timedTitle.test(title(`${timedTag}-not`, `x${timedTag}`))).toBe(false)
  })
})
